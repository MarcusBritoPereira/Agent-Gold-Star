#!/bin/bash
set -e

echo "🚀 Iniciando Deploy do Agente Gold Star (Next.js)..."

# 1. Instalar dependências
echo "📦 Instalando pacotes (npm install)..."
npm install

# 2. Configurar Banco de Dados SQLite
echo "🗄️ Criando Banco de Dados local..."
npx prisma generate
npx prisma db push

# 3. Compilar a Aplicação
echo "🏗️ Compilando o Next.js (npm run build)..."
npm run build

# 4. Iniciar com PM2
echo "🔄 Reiniciando serviço no PM2..."
if pm2 list | grep -q "gold-star-ai"; then
  pm2 restart gold-star-ai
else
  pm2 start npm --name "gold-star-ai" -- start
fi

# 5. Salvar PM2 para reiniciar com o servidor
pm2 save

echo "✅ Deploy concluído! A IA está rodando internamente na porta 3000."
echo "Certifique-se de configurar o Nginx para redirecionar /ai para http://localhost:3000"
