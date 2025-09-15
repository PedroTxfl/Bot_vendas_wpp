// Import Express.js e Axios
const express = require('express');
const axios = require('axios');

// Create an Express app
const app = express();
app.use(express.json());

// --- VARIÁVEIS DE AMBIENTE ---
const port = process.env.PORT || 3000;
const verifyToken = process.env.VERIFY_TOKEN;
const whatsappToken = process.env.WHATSAPP_TOKEN;
const phoneNumberId = process.env.PHONE_NUMBER_ID;

// --- CONTROLE DE ESTADO DA CONVERSA ---
const userState = {};

// --- ROTAS DO SERVIDOR ---
app.get('/', (req, res) => {
  const { 'hub.mode': mode, 'hub.challenge': challenge, 'hub.verify_token': token } = req.query;
  if (mode === 'subscribe' && token === verifyToken) {
    console.log('WEBHOOK VERIFIED');
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

app.post('/', async (req, res) => {
  console.log('Webhook received:', JSON.stringify(req.body, null, 2));
  const message = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

  if (message && message.type === 'text') {
    const from = message.from;
    const msg_body = message.text.body.trim();
    
    if (!userState[from]) {
      userState[from] = { step: 'INIT', formData: {} };
    }
    const currentState = userState[from];

    try {
      // --- ÁRVORE DE DECISÃO ---
      if (currentState.step === 'INIT' && ['oi', 'olá', 'ola', 'bom dia', 'boa tarde', 'boa noite'].includes(msg_body.toLowerCase())) {
        await sendMessage(from, 'Olá, prazer em vê-lo💙😁! Qual produto você deseja comprar:\n\n1. e-CPF\n2. e-CNPJ');
        currentState.step = 'AWAITING_PRODUCT';
      } else if (currentState.step === 'AWAITING_PRODUCT') {
        if (msg_body === '1' || msg_body === '2') {
          currentState.product = msg_body === '1' ? 'e-CPF' : 'e-CNPJ';
          await sendMessage(from, `Certo! E qual a validade do seu ${currentState.product}? ⏳\n\n1. 4 meses\n2. 1 ano\n3. 2 anos\n4. 3 anos`);
          currentState.step = 'AWAITING_VALIDITY';
        } else {
          await sendMessage(from, 'Opção inválida. Por favor, responda com 1 para e-CPF ou 2 para e-CNPJ.');
        }
      } else if (currentState.step === 'AWAITING_VALIDITY') {
        if (['1', '2', '3', '4'].includes(msg_body)) {
          currentState.formData.validade = msg_body;
          await sendMessage(from, 'Entendido. E qual o tipo de certificado?\n\n1. A1 (Arquivo)\n2. A3 (Sem mídia)');
          currentState.step = 'AWAITING_CERTIFICATE_TYPE';
        } else {
          await sendMessage(from, 'Opção de validade inválida. Por favor, escolha um número de 1 a 4.');
        }
      } else if (currentState.step === 'AWAITING_CERTIFICATE_TYPE') {
        if (['1', '2'].includes(msg_body)) {
          currentState.formData.tipoCertificado = msg_body === '1' ? 'A1' : 'A3';
          await sendMessage(from, 'Ótimo! Antes de gerar o pagamento, precisamos de alguns dados para o cadastro.📋');
          if (currentState.product === 'e-CNPJ') {
            await sendMessage(from, 'Por favor, digite o *CNPJ* da empresa:');
            currentState.step = 'AWAITING_CNPJ';
          } else {
            await sendMessage(from, 'Por favor, digite seu *CPF*:');
            currentState.step = 'AWAITING_CPF';
          }
        } else {
          await sendMessage(from, 'Opção inválida. Por favor, escolha 1 para A1 ou 2 para A3.');
        }

      // --- Início do Formulário ---
      } else if (currentState.step === 'AWAITING_CNPJ') {
        currentState.formData.cnpj = msg_body;
        await handleFormStep(from, currentState, 'AWAITING_RAZAO_SOCIAL', 'Qual a Razão Social da empresa?');
      } else if (currentState.step === 'AWAITING_RAZAO_SOCIAL') {
        currentState.formData.razaoSocial = msg_body;
        await handleFormStep(from, currentState, 'AWAITING_CPF', 'Obrigado. Agora, por favor, digite o *CPF* do representante legal:');
      } else if (currentState.step === 'AWAITING_CPF') {
        currentState.formData.cpf = msg_body;
        await handleFormStep(from, currentState, 'AWAITING_DOB', 'Qual sua *data de nascimento*? (DD/MM/AAAA)');
      } else if (currentState.step === 'AWAITING_DOB') {
        currentState.formData.dob = msg_body;
        await handleFormStep(from, currentState, 'AWAITING_NAME', 'Qual seu *nome completo*?');
      } else if (currentState.step === 'AWAITING_NAME') {
        currentState.formData.name = msg_body;
        await handleFormStep(from, currentState, 'AWAITING_EMAIL', 'Digite seu melhor *e-mail*:');
      } else if (currentState.step === 'AWAITING_EMAIL') {
        currentState.formData.email = msg_body;
        await handleFormStep(from, currentState, 'AWAITING_PHONE', 'Qual o seu *número de celular* com DDD?');
      } else if (currentState.step === 'AWAITING_PHONE') {
        currentState.formData.phone = msg_body;
        await handleFormStep(from, currentState, 'AWAITING_CEP', 'Agora, seu endereço. Qual o *CEP*?');
      } else if (currentState.step === 'AWAITING_CEP') {
        currentState.formData.cep = msg_body;
        await handleFormStep(from, currentState, 'AWAITING_NUMBER', 'Informações do CEP: \n\n*Rua*: Princesa Isabel\n*Bairro*: Santana\n*Cidade*: Porto Alegre\n*Estado*: Rio Grande do Sul\n\nAgora precisamos saber qual o número?');
      
      // ALTERADO: Último passo do formulário agora vai para a tela de confirmação.
      } else if (currentState.step === 'AWAITING_NUMBER') {
        currentState.formData.number = msg_body;
        currentState.step = 'AWAITING_CONFIRMATION';
        await generateAndSendConfirmationMessage(from, currentState);

      // NOVO: Passo de confirmação e edição.
      } else if (currentState.step === 'AWAITING_CONFIRMATION') {
        if (msg_body.toLowerCase() === 'confirmar') {
          // O usuário confirmou, segue para o pagamento.
          const pixCode = '00020126330014br.gov.bcb.pix01111234567890102040000030398604100.0053039865802BR5913NOME COMPLETO6009SAO PAULO62070503***6304ABCD';
          await sendMessage(from, `Obrigado! Cadastro confirmado.\n\nO valor total é de R$ 185,00.\n\nSegue o código *PIX para pagamento*:\n\n${pixCode}`);
          handlePostPaymentSimulation(from);
          currentState.step = 'VALIDATION_PENDING';
        } else {
          // O usuário quer editar. Verificamos se é um número válido.
          const fieldIndex = parseInt(msg_body, 10);
          const fields = getEditableFields(currentState);
          if (!isNaN(fieldIndex) && fieldIndex > 0 && fieldIndex <= fields.length) {
            const fieldToEdit = fields[fieldIndex - 1];
            currentState.returnTo = 'AWAITING_CONFIRMATION'; // Salva para onde voltar
            currentState.step = fieldToEdit.step;
            await sendMessage(from, `Ok, vamos corrigir seu *${fieldToEdit.label}*.\n\nPor favor, digite novamente:`);
          } else {
            await sendMessage(from, 'Opção inválida. Por favor, digite "Confirmar" ou o número do campo que deseja editar.');
          }
        }
      } else if (currentState.step !== 'VALIDATION_PENDING') {
        await sendMessage(from, 'Não entendi sua resposta. Digite "Olá" para (re)começar o atendimento.');
        delete userState[from];
      }
    } catch (error) {
      console.error('Error processing message:', error);
    }
  }
  res.sendStatus(200);
});


// --- FUNÇÕES AUXILIARES ---

// NOVO: Função auxiliar para lidar com o avanço no formulário e o retorno da edição
async function handleFormStep(from, currentState, nextStep, nextQuestion) {
  if (currentState.returnTo) {
    const returnState = currentState.returnTo;
    delete currentState.returnTo; // Limpa a flag de retorno
    currentState.step = returnState;
    await generateAndSendConfirmationMessage(from, currentState);
  } else {
    currentState.step = nextStep;
    await sendMessage(from, nextQuestion);
  }
}

// NOVO: Função para obter a lista de campos editáveis
function getEditableFields(currentState) {
    const fields = [];
    if (currentState.product === 'e-CNPJ') {
        fields.push({ label: 'CNPJ', step: 'AWAITING_CNPJ', value: currentState.formData.cnpj });
        fields.push({ label: 'Razão Social', step: 'AWAITING_RAZAO_SOCIAL', value: currentState.formData.razaoSocial });
    }
    fields.push({ label: 'CPF', step: 'AWAITING_CPF', value: currentState.formData.cpf });
    fields.push({ label: 'Data de Nascimento', step: 'AWAITING_DOB', value: currentState.formData.dob });
    fields.push({ label: 'Nome Completo', step: 'AWAITING_NAME', value: currentState.formData.name });
    fields.push({ label: 'E-mail', step: 'AWAITING_EMAIL', value: currentState.formData.email });
    fields.push({ label: 'Celular', step: 'AWAITING_PHONE', value: currentState.formData.phone });
    fields.push({ label: 'CEP', step: 'AWAITING_CEP', value: currentState.formData.cep });
    fields.push({ label: 'Número', step: 'AWAITING_NUMBER', value: currentState.formData.number });
    return fields;
}

// NOVO: Função que gera e envia a mensagem de confirmação
async function generateAndSendConfirmationMessage(from, currentState) {
    let confirmationText = '📝 *Por favor, confirme seus dados:*\n\n';
    const fields = getEditableFields(currentState);

    fields.forEach((field, index) => {
        confirmationText += `${index + 1}. *${field.label}*: ${field.value}\n`;
    });

    confirmationText += '\nSe todos os dados estiverem corretos, digite *Confirmar*.\nPara corrigir, digite o *número* do campo que deseja alterar.';
    await sendMessage(from, confirmationText);
}

function handlePostPaymentSimulation(userNumber) {
    setTimeout(async () => {
        await sendMessage(userNumber, 'O pagamento foi efetuado! ✅');
        await sendMessage(userNumber, 'Segue agora o link para upload dos documentos:\nhttps://link.falso.para.upload/doc123');
        setTimeout(async () => {
            await sendMessage(userNumber, 'Seus documentos estão sendo validados... ⏳');
            setTimeout(async () => {
                await sendMessage(userNumber, 'Pronto, documentos validados! 📄\n\nSegue o link para realização da vídeo conferência:\nhttps://link.falso.para.video/conf456');
                setTimeout(async () => {
                    await sendMessage(userNumber, 'Parabéns! Seu certificado foi emitido com sucesso! 🎉');
                    delete userState[userNumber];
                }, 10000);
            }, 4000);
        }, 4000);
    }, 10000);
}

async function sendMessage(to, text) {
  const url = `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`;
  const data = { messaging_product: 'whatsapp', to, type: 'text', text: { body: text } };
  const headers = { 'Authorization': `Bearer ${whatsappToken}`, 'Content-Type': 'application/json' };
  try {
    console.log(`Sending message to ${to}: "${text}"`);
    await axios.post(url, data, { headers });
    console.log('Message sent successfully!');
  } catch (error) {
    console.error('Error sending message:', error.response ? error.response.data : error.message);
  }
}

app.listen(port, () => {
  console.log(`\nServer is listening on port ${port}`);
});