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

// Rota GET para verificação do Webhook
app.get('/', (req, res) => {
  const { 'hub.mode': mode, 'hub.challenge': challenge, 'hub.verify_token': token } = req.query;
  if (mode === 'subscribe' && token === verifyToken) {
    console.log('WEBHOOK VERIFIED');
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// Rota POST para receber mensagens do WhatsApp
app.post('/', async (req, res) => {
  console.log('Webhook received:', JSON.stringify(req.body, null, 2));
  const message = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

  if (message && message.type === 'text') {
    const from = message.from;
    const msg_body = message.text.body.trim();
    
    // Inicializa o estado do usuário se for a primeira mensagem
    if (!userState[from]) {
      userState[from] = { step: 'INIT', formData: {} };
    }
    const currentState = userState[from];

    try {
      // --- ÁRVORE DE DECISÃO BASEADA EM ESTADO ---

      // Passo 0: Início da Conversa
      if (currentState.step === 'INIT' && ['oi', 'olá', 'ola', 'bom dia', 'boa tarde', 'boa noite'].includes(msg_body.toLowerCase())) {
        await sendMessage(from, 'Olá, prazer em vê-lo! Qual produto você deseja comprar:\n\n1. e-CPF\n2. e-CNPJ');
        currentState.step = 'AWAITING_PRODUCT';

      // Passo 1: Escolha do Produto
      } else if (currentState.step === 'AWAITING_PRODUCT') {
        if (msg_body === '1' || msg_body === '2') {
          currentState.product = msg_body === '1' ? 'e-CPF' : 'e-CNPJ';
          await sendMessage(from, 'Certo! E qual a validade do seu produto?\n\n1. 4 meses\n2. 1 ano\n3. 2 anos\n4. 3 anos');
          currentState.step = 'AWAITING_VALIDITY';
        } else {
          await sendMessage(from, 'Opção inválida. Por favor, responda com 1 para e-CPF ou 2 para e-CNPJ.');
        }

      // ALTERADO: Passo 2 agora inicia o formulário, em vez de pedir o pagamento.
      } else if (currentState.step === 'AWAITING_VALIDITY') {
        if (['1', '2', '3', '4'].includes(msg_body)) {
          await sendMessage(from, 'Ótimo! Antes de gerar o pagamento, precisamos de alguns dados para o cadastro.');
          
          // Verifica o produto escolhido e direciona para a pergunta correta
          if (currentState.product === 'e-CNPJ') {
              await sendMessage(from, 'Por favor, digite o CNPJ da empresa:');
              currentState.step = 'AWAITING_CNPJ';
          } else { // Se for e-CPF
              await sendMessage(from, 'Por favor, digite seu CPF:');
              currentState.step = 'AWAITING_CPF';
          }
        } else {
          await sendMessage(from, 'Opção de validade inválida. Por favor, escolha um número de 1 a 4.');
        }

      // --- Início do Formulário (Lógica inalterada, apenas a ordem de chamada mudou) ---

      } else if (currentState.step === 'AWAITING_CNPJ') {
        currentState.formData.razaoSocial = 'Safeweb Segurança da Informação Ltda';
        await sendMessage(from, 'Certo, Razão social de: Safeweb Segurança da Informação Ltda. Agora, por favor, digite o CPF do representante legal:');
        currentState.step = 'AWAITING_CPF';

      } else if (currentState.step === 'AWAITING_CPF') {
        currentState.formData.cpf = msg_body;
        await sendMessage(from, 'Certo, CPF no nome de: Seifywébinsson machado. \n\nQual sua data de nascimento? (DD/MM/AAAA)');
        currentState.step = 'AWAITING_DOB';

      } else if (currentState.step === 'AWAITING_DOB') {
        currentState.formData.name = msg_body;
        await sendMessage(from, 'Digite seu melhor e-mail:');
        currentState.step = 'AWAITING_EMAIL';
      } else if (currentState.step === 'AWAITING_EMAIL') {
        currentState.formData.email = msg_body;
        await sendMessage(from, 'Qual o seu número de celular com DDD?');
        currentState.step = 'AWAITING_PHONE';
      } else if (currentState.step === 'AWAITING_PHONE') {
        currentState.formData.phone = msg_body;
        await sendMessage(from, 'Agora, seu endereço. Qual o CEP?');
        currentState.step = 'AWAITING_CEP';
      
      } else if (currentState.step === 'AWAITING_CEP') {
        currentState.formData.cep = msg_body;
        await sendMessage(from, 'Informações do CEP: \n\n*Rua*: Princesa Isabel\n*Bairro*: Santana\n*Cidade*: Porto Alegre\n*Estado*: Rio Grande do Sul\n\nAgora precisamos saber qual o número?');
        currentState.step = 'AWAITING_NUMBER';
        
      // ALTERADO: O fim do formulário agora aciona o PAGAMENTO.
      } else if (currentState.step === 'AWAITING_NUMBER') {
        currentState.formData.number = msg_body;
        
        console.log('Formulário preenchido:', currentState.formData);
        
        // Envia a mensagem de pagamento APÓS o formulário
        const pixCode = '00020126330014br.gov.bcb.pix01111234567890102040000030398604100.0053039865802BR5913NOME COMPLETO6009SAO PAULO62070503***6304ABCD';
        await sendMessage(from, `Obrigado! Cadastro preenchido.\n\nO valor total é de R$ 100,00.\n\nSegue o código PIX para pagamento:\n\n${pixCode}`);
        
        // Inicia a simulação do pagamento E validação dos documentos
        handlePostPaymentSimulation(from);
        currentState.step = 'VALIDATION_PENDING'; // Bloqueia novas interações
      
      } else if (currentState.step !== 'VALIDATION_PENDING') { // Renomeado de PAYMENT_PENDING
        await sendMessage(from, 'Não entendi sua resposta. Digite "Olá" para (re)começar o atendimento.');
        delete userState[from]; // Reinicia o estado
      }
    } catch (error) {
      console.error('Error processing message:', error);
    }
  }
  res.sendStatus(200);
});


// --- FUNÇÕES AUXILIARES ---

// REMOVIDA: A função handlePaymentSimulation foi integrada na handlePostPaymentSimulation
// ALTERADA: A lógica de simulação agora começa após o pagamento e inclui tudo
function handlePostPaymentSimulation(userNumber) {
    // 1. Simula o tempo que o usuário leva para pagar (10 segundos)
    setTimeout(async () => {
        await sendMessage(userNumber, 'O pagamento foi efetuado! ✅');
        
        // 2. Imediatamente após o pagamento, envia o link dos documentos
        await sendMessage(userNumber, 'Segue agora o link para upload dos documentos:\nhttps://link.falso.para.upload/doc123');
        
        // 3. Simula a validação dos documentos (4 segundos)
        setTimeout(async () => {
            await sendMessage(userNumber, 'Seus documentos estão sendo validados... ⏳');
            
            // 4. Simula a finalização da validação (mais 4 segundos)
            setTimeout(async () => {
                await sendMessage(userNumber, 'Pronto, documentos validados! 📄\n\nSegue o link para realização da vídeo conferência:\nhttps://link.falso.para.video/conf456');
                
                setTimeout(async () => {
                    await sendMessage(userNumber, 'Parabéns! Seu certificado foi emitido com sucesso! 🎉');

                  // Limpa o estado do usuário para que ele possa começar de novo
                    delete userState[userNumber];
                }, 10000);
            }, 4000);
        }, 4000);
    }, 10000);
}


// Função para enviar mensagens via API do WhatsApp
async function sendMessage(to, text) {
  const url = `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`;
  const data = {
    messaging_product: 'whatsapp', to, type: 'text', text: { body: text },
  };
  const headers = { 'Authorization': `Bearer ${whatsappToken}`, 'Content-Type': 'application/json' };
  try {
    console.log(`Sending message to ${to}: "${text}"`);
    await axios.post(url, data, { headers });
    console.log('Message sent successfully!');
  } catch (error) {
    console.error('Error sending message:', error.response ? error.response.data : error.message);
  }
}

// Inicia o servidor
app.listen(port, () => {
  console.log(`\nServer is listening on port ${port}`);
});