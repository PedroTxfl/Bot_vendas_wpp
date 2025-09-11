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

      // Passo 2: Escolha da Validade e Pagamento
      } else if (currentState.step === 'AWAITING_VALIDITY') {
        if (['1', '2', '3', '4'].includes(msg_body)) {
          const pixCode = '00020126330014br.gov.bcb.pix01111234567890102040000030398604100.0053039865802BR5913NOME COMPLETO6009SAO PAULO62070503***6304ABCD';
          await sendMessage(from, `Perfeito! O valor total é de R$ 100,00.\n\nSegue o código PIX para pagamento:\n\n${pixCode}`);
          
          // Inicia a simulação do pagamento
          handlePaymentSimulation(from);
          currentState.step = 'PAYMENT_PENDING'; // Bloqueia novas interações enquanto simula
        } else {
          await sendMessage(from, 'Opção de validade inválida. Por favor, escolha um número de 1 a 4.');
        }

      // --- Início do Formulário ---
      } else if (currentState.step === 'AWAITING_CPF') {
        currentState.formData.cpf = msg_body;
        await sendMessage(from, 'Qual sua data de nascimento? (DD/MM/AAAA)');
        currentState.step = 'AWAITING_DOB';
      } else if (currentState.step === 'AWAITING_DOB') {
        currentState.formData.dob = msg_body;
        await sendMessage(from, 'Qual seu nome completo?');
        currentState.step = 'AWAITING_NAME';
      } else if (currentState.step === 'AWAITING_NAME') {
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
        await sendMessage(from, 'Qual o nome da rua/avenida (logradouro)?');
        currentState.step = 'AWAITING_ADDRESS';
      } else if (currentState.step === 'AWAITING_ADDRESS') {
        currentState.formData.address = msg_body;
        await sendMessage(from, 'Qual o bairro?');
        currentState.step = 'AWAITING_NEIGHBORHOOD';
      } else if (currentState.step === 'AWAITING_NEIGHBORHOOD') {
        currentState.formData.neighborhood = msg_body;
        await sendMessage(from, 'E para finalizar, qual o número?');
        currentState.step = 'AWAITING_NUMBER';
      } else if (currentState.step === 'AWAITING_NUMBER') {
        currentState.formData.number = msg_body;
        
        console.log('Formulário preenchido:', currentState.formData); // Você pode ver os dados no log do Render
        await sendMessage(from, 'Obrigado pelas informações!');
        
        // Inicia a simulação da validação de documentos
        handleDocumentValidation(from);
        currentState.step = 'VALIDATION_PENDING'; // Bloqueia novas interações
      
      } else if (currentState.step !== 'PAYMENT_PENDING' && currentState.step !== 'VALIDATION_PENDING') {
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

// Simula o tempo de pagamento e inicia o formulário
function handlePaymentSimulation(userNumber) {
    setTimeout(async () => {
        await sendMessage(userNumber, 'O pagamento foi efetuado! ✅\n\nAgora, para agilizar seu atendimento, precisamos de algumas informações suas.');
        await sendMessage(userNumber, 'Por favor, digite seu CPF:');
        
        // Atualiza o estado para começar a coleta de dados
        if (userState[userNumber]) {
            userState[userNumber].step = 'AWAITING_CPF';
        }
    }, 10000); // 10 segundos
}

// Simula os passos finais de validação
function handleDocumentValidation(userNumber) {
    // A primeira mensagem é imediata
    sendMessage(userNumber, 'Segue agora o link para upload dos documentos:\nhttps://link.falso.para.upload/doc123');
    
    // Aguarda 4 segundos para a próxima
    setTimeout(async () => {
        await sendMessage(userNumber, 'Seus documentos estão sendo validados... ⏳');
        
        // Aguarda mais 4 segundos para finalizar
        setTimeout(async () => {
            await sendMessage(userNumber, 'Pronto, documentos validados! 📄\n\nSegue o link para realização da vídeo conferência:\nhttps://link.falso.para.video/conf456');
            
            // Limpa o estado do usuário para que ele possa começar de novo
            delete userState[userNumber];
        }, 4000);
    }, 4000);
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
