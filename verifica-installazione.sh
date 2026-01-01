#!/bin/bash

# Script di verifica installazione
clear
echo "═══════════════════════════════════════════════════════════"
echo "  🔍 VERIFICA INSTALLAZIONE - Ordini Fiori"
echo "═══════════════════════════════════════════════════════════"
echo ""

# Colori
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Contatori
PASS=0
FAIL=0

# Funzione check
check() {
  if [ $1 -eq 0 ]; then
    echo -e "${GREEN}✓${NC} $2"
    ((PASS++))
  else
    echo -e "${RED}✗${NC} $2"
    ((FAIL++))
  fi
}

echo "📋 Verifica file progetto..."
echo "─────────────────────────────────────────────────────────"

[ -f "server.js" ]; check $? "server.js"
[ -f "database.js" ]; check $? "database.js"
[ -f "package.json" ]; check $? "package.json"
[ -f "public/index.html" ]; check $? "public/index.html"
[ -f "public/styles.css" ]; check $? "public/styles.css"
[ -f "public/app.js" ]; check $? "public/app.js"
[ -f "public/manifest.json" ]; check $? "public/manifest.json"
[ -f "public/service-worker.js" ]; check $? "public/service-worker.js"
[ -f "public/icon-192.png" ]; check $? "public/icon-192.png"
[ -f "public/icon-512.png" ]; check $? "public/icon-512.png"

echo ""
echo "📚 Verifica documentazione..."
echo "─────────────────────────────────────────────────────────"

[ -f "README.md" ]; check $? "README.md"
[ -f "GUIDA-RAPIDA.md" ]; check $? "GUIDA-RAPIDA.md"
[ -f "LEGGIMI.txt" ]; check $? "LEGGIMI.txt"
[ -f "INIZIA-QUI.txt" ]; check $? "INIZIA-QUI.txt"
[ -f "CHECKLIST.md" ]; check $? "CHECKLIST.md"

echo ""
echo "🛠️  Verifica script utilità..."
echo "─────────────────────────────────────────────────────────"

[ -f "test-data.js" ]; check $? "test-data.js"
[ -f "generate-icons.js" ]; check $? "generate-icons.js"
[ -f "avvia.sh" ]; check $? "avvia.sh"
[ -x "avvia.sh" ]; check $? "avvia.sh è eseguibile"

echo ""
echo "🔧 Verifica Node.js..."
echo "─────────────────────────────────────────────────────────"

command -v node >/dev/null 2>&1
check $? "Node.js installato"

command -v npm >/dev/null 2>&1
check $? "npm installato"

if command -v node >/dev/null 2>&1; then
  NODE_VERSION=$(node --version)
  echo "   Versione Node.js: $NODE_VERSION"
fi

echo ""
echo "📦 Verifica dipendenze..."
echo "─────────────────────────────────────────────────────────"

if [ -d "node_modules" ]; then
  echo -e "${GREEN}✓${NC} node_modules/ presente"
  ((PASS++))
  
  [ -d "node_modules/express" ]; check $? "express installato"
  [ -d "node_modules/better-sqlite3" ]; check $? "better-sqlite3 installato"
  [ -d "node_modules/cors" ]; check $? "cors installato"
else
  echo -e "${YELLOW}⚠${NC} node_modules/ mancante (esegui: npm install)"
  ((FAIL++))
fi

echo ""
echo "💾 Verifica database..."
echo "─────────────────────────────────────────────────────────"

if [ -f "ordini.db" ]; then
  echo -e "${GREEN}✓${NC} ordini.db presente"
  ((PASS++))
  DB_SIZE=$(ls -lh ordini.db | awk '{print $5}')
  echo "   Dimensione: $DB_SIZE"
else
  echo -e "${YELLOW}⚠${NC} ordini.db non presente (verrà creato all'avvio)"
fi

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  📊 RISULTATO"
echo "═══════════════════════════════════════════════════════════"
echo ""
echo -e "Test passati:  ${GREEN}$PASS${NC}"
echo -e "Test falliti:  ${RED}$FAIL${NC}"
echo ""

if [ $FAIL -eq 0 ]; then
  echo -e "${GREEN}🎉 TUTTO OK! Il progetto è pronto per l'uso.${NC}"
  echo ""
  echo "Per avviare:"
  echo "  npm start"
  echo ""
elif [ $FAIL -le 5 ]; then
  echo -e "${YELLOW}⚠️  Alcuni file mancano ma il progetto dovrebbe funzionare.${NC}"
  echo ""
  echo "Prova a eseguire:"
  echo "  npm install"
  echo "  npm start"
  echo ""
else
  echo -e "${RED}❌ Ci sono problemi. Controlla i file mancanti.${NC}"
  echo ""
fi

echo "═══════════════════════════════════════════════════════════"
