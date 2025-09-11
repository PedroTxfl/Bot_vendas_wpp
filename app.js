// Import Express.js e Axios
const express = require('express');
const axios = require('axios');

// Create an Express app
const app = express();
app.use(express.json());

// --- VARIÁVEIS DE AMBIENTE ---
// Configure estas variáveis no seu ambiente do Render
const port = process.env.PORT || 3000;
const verifyToken = process.env.VERIFY_TOKEN;    // Seu token de verificação
const whatsappToken = process.env.WHATSAPP_TOKEN;  // Seu token de acesso da API
const phoneNumberId = process.env.PHONE_NUMBER_ID; // ID do seu número de telefone

// --- CONTROLE DE ESTADO DA CONVERSA ---
// Armazena o passo atual de cada usuário na conversa
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
    const from = message.from; // Número do usuário
    const msg_body = message.text.body.toLowerCase().trim(); // Texto da mensagem

    try {
      // Inicializa o estado do usuário se for a primeira mensagem
      if (!userState[from]) {
        userState[from] = { step: 'INIT' };
      }

      // --- ÁRVORE DE DECISÃO BASEADA EM ESTADO ---
      const currentState = userState[from];

      if (currentState.step === 'INIT' && ['oi', 'olá', 'ola', 'bom dia', 'boa tarde', 'boa noite'].includes(msg_body)) {
        // Passo 1: Pergunta o produto
        await sendMessage(from, 'Olá, prazer em vê-lo! Qual produto você deseja comprar:\n\n1. e-CPF\n2. e-CNPJ');
        currentState.step = 'AWAITING_PRODUCT';

      } else if (currentState.step === 'AWAITING_PRODUCT') {
        // Passo 2: Pergunta a validade
        if (msg_body === '1' || msg_body === '2') {
          currentState.product = msg_body === '1' ? 'e-CPF' : 'e-CNPJ'; // Salva a escolha
          await sendMessage(from, 'Certo! E qual a validade do seu produto?\n\n1. 4 meses\n2. 1 ano\n3. 2 anos\n4. 3 anos');
          currentState.step = 'AWAITING_VALIDITY';
        } else {
          await sendMessage(from, 'Opção inválida. Por favor, responda com 1 para e-CPF ou 2 para e-CNPJ.');
        }

      } else if (currentState.step === 'AWAITING_VALIDITY') {
        // Passo 3: Informa o preço e PIX
        if (['1', '2', '3', '4'].includes(msg_body)) {
          const pixCode = '00020126330014br.gov.bcb.pix01111234567890102040000030398604100.0053039865802BR5913NOME COMPLETO6009SAO PAULO62070503***6304ABCD'; // PIX Falso
          await sendMessage(from, `Perfeito! O valor total é de R$ 100,00.\n\nSegue o código PIX para pagamento:\n\n${pixCode}`);
          currentState.step = 'AWAITING_PAYMENT';
          
          // Simula o tempo de pagamento e os próximos passos
          handlePaymentSimulation(from);
        } else {
          await sendMessage(from, 'Opção de validade inválida. Por favor, escolha um número de 1 a 4.');
        }

      } else {
        // Resposta padrão para qualquer outra mensagem
        await sendMessage(from, 'Não entendi sua resposta. Digite "Olá" para (re)começar o atendimento.');
        delete userState[from]; // Reinicia o estado do usuário
      }

    } catch (error) {
      console.error('Error processing message:', error);
    }
  }

  res.sendStatus(200);
});

// --- FUNÇÕES AUXILIARES ---

// Função para simular os passos após o pagamento com delays
function handlePaymentSimulation(userNumber) {
    // Aguarda 10 segundos para simular o pagamento
    setTimeout(async () => {
        await sendMessage(userNumber, 'O pagamento foi efetuado! ✅\n\nSegue agora o link para upload dos documentos:\nhttps://link.falso.para.upload/doc123');
        
        // Aguarda mais 4 segundos para simular validação
        setTimeout(async () => {
            await sendMessage(userNumber, 'Seus documentos estão sendo validados... ⏳');
            
            // Aguarda mais 4 segundos para finalizar
            setTimeout(async () => {
                await sendMessage(userNumber, 'Pronto, documentos validados! 📄\n\nSegue o link para realização da vídeo conferência:\nhttps://link.falso.para.video/conf456');
                
                // Limpa o estado do usuário para que ele possa começar de novo
                delete userState[userNumber];
            }, 4000); // 4 segundos
        }, 4000); // 4 segundos
    }, 10000); // 10 segundos
}

// Função para enviar mensagens via API do WhatsApp
async function sendMessage(to, text) {
  const url = `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`;
  const data = {
    messaging_product: 'whatsapp',
    to: to,
    type: 'text',
    text: { body: text },
  };
  const headers = {
    'Authorization': `Bearer ${whatsappToken}`,
    'Content-Type': 'application/json',
  };

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
