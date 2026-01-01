#!/bin/bash

# Script di avvio rapido per Ordini Fiori
# Per usarlo: chmod +x avvia.sh && ./avvia.sh

clear
echo "════════════════════════════════════════"
echo "  🌸 ORDINI FIORI - Avvio Server"
echo "════════════════════════════════════════"
echo ""

# Verifica Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.js non trovato!"
    echo "   Installa Node.js da: https://nodejs.org"
    exit 1
fi

# Verifica dipendenze
if [ ! -d "node_modules" ]; then
    echo "📦 Installazione dipendenze..."
    npm install
    echo ""
fi

# Ottieni indirizzo IP
echo "🔍 Rilevamento indirizzo IP..."
if [[ "$OSTYPE" == "darwin"* ]]; then
    # macOS
    IP=$(ifconfig | grep "inet " | grep -v 127.0.0.1 | awk '{print $2}' | head -1)
else
    # Linux
    IP=$(hostname -I | awk '{print $1}')
fi

echo "📱 Indirizzo per telefono: http://$IP:3000"
echo ""
echo "▶️  Avvio server..."
echo ""
echo "════════════════════════════════════════"
echo ""

# Avvia server
npm start

