# 🌸 Ordini Fiori - Web App Mobile

Web app mobile-first per la gestione degli ordini di un'azienda di fiori all'ingrosso.

## 📋 Caratteristiche

- ✅ **Calendario** con vista mensile e lista giorni
- ✅ **Gestione ordini** per giorno con 3 stati: Da preparare, Pronto, Ritirato
- ✅ **Interface mobile-first** ottimizzata per smartphone
- ✅ **Multi-utente** con backend e database condiviso
- ✅ **PWA** - Installabile sulla schermata home del telefono
- ✅ **Interfaccia in italiano** semplice e intuitiva

## 🚀 Installazione

### Prerequisiti

- **Node.js** (versione 14 o superiore)
- **npm** (incluso con Node.js)

### Passo 1: Installa Node.js

Se non hai già Node.js installato:

- **macOS**: Scarica da [nodejs.org](https://nodejs.org/) oppure usa `brew install node`
- **Windows/Linux**: Scarica da [nodejs.org](https://nodejs.org/)

Verifica l'installazione:
```bash
node --version
npm --version
```

### Passo 2: Installa le dipendenze

Apri il terminale nella cartella del progetto ed esegui:

```bash
cd ordini-fiori
npm install
```

Questo installerà:
- `express` - Server web
- `better-sqlite3` - Database SQLite
- `cors` - Gestione CORS per API

### Passo 3: Genera le icone PWA (opzionale)

Per generare le icone dell'app:

1. Apri il file `create-icons.html` nel browser
2. Clicca su "Scarica Icone"
3. Sposta i file `icon-192.png` e `icon-512.png` nella cartella `public/`

*Nota: Se non generi le icone, l'app funzionerà comunque, ma non avrà un'icona personalizzata quando installata.*

## 🎯 Avvio del Server

### Su Computer

```bash
npm start
```

Il server si avvierà sulla porta 3000. Vedrai un messaggio tipo:

```
🌸 Server ordini fiori avviato!
📱 Apri dal telefono: http://192.168.1.X:3000
💻 Apri dal computer: http://localhost:3000
```

### Accesso da Telefono

#### Passo 1: Trova l'indirizzo IP del tuo computer

**macOS/Linux:**
```bash
ifconfig | grep "inet " | grep -v 127.0.0.1
```

**Windows:**
```bash
ipconfig
```

Cerca l'indirizzo IPv4 (es. `192.168.1.15`)

#### Passo 2: Connetti il telefono alla stessa rete Wi-Fi

Assicurati che il telefono sia connesso alla **stessa rete Wi-Fi** del computer.

#### Passo 3: Apri l'app dal telefono

Sul browser del telefono (Safari su iPhone, Chrome su Android), vai a:

```
http://[IP-del-tuo-computer]:3000
```

Esempio: `http://192.168.1.15:3000`

## 📱 Installazione come PWA (App sulla Home)

### iPhone (Safari)

1. Apri l'app in Safari
2. Tocca il pulsante **Condividi** (icona quadrato con freccia)
3. Scorri e tocca **"Aggiungi a Home"**
4. Tocca **"Aggiungi"**
5. L'app apparirà sulla schermata home come un'app normale!

### Android (Chrome)

1. Apri l'app in Chrome
2. Tocca il menu (⋮) in alto a destra
3. Seleziona **"Aggiungi a schermata Home"** o **"Installa app"**
4. Tocca **"Aggiungi"** o **"Installa"**
5. L'app apparirà sulla schermata home!

## 🔧 Struttura del Progetto

```
ordini-fiori/
├── server.js              # Server Express con API REST
├── database.js            # Gestione database SQLite
├── package.json           # Dipendenze Node.js
├── ordini.db             # Database SQLite (creato automaticamente)
├── public/               # File frontend
│   ├── index.html        # Struttura HTML
│   ├── styles.css        # Stili CSS mobile-first
│   ├── app.js            # Logica JavaScript
│   ├── manifest.json     # Configurazione PWA
│   ├── service-worker.js # Service Worker per PWA
│   ├── icon-192.png      # Icona PWA 192x192 (opzionale)
│   └── icon-512.png      # Icona PWA 512x512 (opzionale)
└── README.md             # Questo file
```

## 📊 Database

Il database SQLite (`ordini.db`) viene creato automaticamente al primo avvio.

### Struttura tabella `orders`

| Campo | Tipo | Descrizione |
|-------|------|-------------|
| id | INTEGER | ID univoco (auto-incrementale) |
| date | TEXT | Data ordine (YYYY-MM-DD) |
| customer | TEXT | Nome cliente |
| description | TEXT | Descrizione ordine (testo libero) |
| status | TEXT | Stato: `da_preparare`, `pronto`, `ritirato` |
| created_at | DATETIME | Data/ora creazione |
| updated_at | DATETIME | Data/ora ultimo aggiornamento |

## 🌐 API Endpoints

Il backend espone le seguenti API REST:

| Metodo | Endpoint | Descrizione |
|--------|----------|-------------|
| GET | `/api/orders` | Ottieni tutti gli ordini |
| GET | `/api/orders/date/:date` | Ottieni ordini di una data specifica |
| GET | `/api/orders/:id` | Ottieni singolo ordine |
| POST | `/api/orders` | Crea nuovo ordine |
| PUT | `/api/orders/:id` | Aggiorna ordine completo |
| PATCH | `/api/orders/:id/status` | Aggiorna solo lo stato |
| DELETE | `/api/orders/:id` | Elimina ordine |
| GET | `/api/stats/dates` | Statistiche ordini per data (per calendario) |

### Esempi di chiamate API

**Creare un nuovo ordine:**
```bash
curl -X POST http://localhost:3000/api/orders \
  -H "Content-Type: application/json" \
  -d '{
    "date": "2025-03-15",
    "customer": "Fioreria Rossi",
    "description": "3 casse rose bianche, 5 mazzi eucalyptus"
  }'
```

**Aggiornare stato ordine:**
```bash
curl -X PATCH http://localhost:3000/api/orders/1/status \
  -H "Content-Type: application/json" \
  -d '{"status": "pronto"}'
```

## 🎨 Funzionalità dell'App

### Pagina Calendario
- Vista mensile con navigazione mese precedente/successivo
- Ogni giorno mostra:
  - Numero totale di ordini
  - Indicatori colorati per ordini "da preparare" e "pronti"
- Toccare un giorno per vedere gli ordini di quel giorno

### Pagina Ordini del Giorno
- Lista di tutti gli ordini del giorno selezionato
- Ogni ordine mostra:
  - Nome cliente
  - Descrizione completa
  - Badge colorato con lo stato attuale
- Azioni rapide:
  - **Modifica**: apre il form di modifica
  - **Pronto**: cambia stato a "Pronto" (se è "Da preparare")
  - **Ritirato**: cambia stato a "Ritirato" (se è "Pronto")

### Form Nuovo Ordine
- Campi semplici: Data, Cliente, Descrizione
- Stato iniziale automatico: "Da preparare"
- Validazione campi obbligatori

### Form Modifica Ordine
- Tutti i campi modificabili
- Possibilità di cambiare lo stato con pulsanti grandi
- Pulsante "Elimina ordine" con conferma

## 🛠️ Manutenzione

### Backup del Database

Il file `ordini.db` contiene tutti i dati. Per fare un backup:

```bash
cp ordini.db ordini-backup-$(date +%Y%m%d).db
```

### Reset del Database

Per eliminare tutti i dati e ricominciare da zero:

```bash
rm ordini.db
npm start  # Verrà ricreato automaticamente
```

### Log e Debug

Il server mostra log nel terminale per ogni richiesta API. In caso di problemi, controlla i messaggi di errore nel terminale.

## 🔒 Sicurezza

**ATTENZIONE**: Questa app è pensata per uso interno su rete locale privata.

Per uso in produzione su Internet, considera:
- Aggiungere autenticazione utenti
- Usare HTTPS con certificato SSL
- Implementare limitazione rate delle richieste
- Validazione input più rigorosa
- Backup automatici del database

## ❓ Problemi Comuni

### Il telefono non riesce a connettersi

1. Verifica che telefono e computer siano sulla stessa rete Wi-Fi
2. Verifica che il firewall del computer non blocchi la porta 3000
3. Su Mac, vai in Impostazioni di Sistema > Rete > Firewall e permetti connessioni a Node

### L'app è lenta

1. Verifica la connessione Wi-Fi
2. Il database SQLite è molto veloce, ma se hai migliaia di ordini potresti notare rallentamenti
3. Considera di archiviare ordini vecchi (oltre 6 mesi) in una tabella separata

### Errore "port already in use"

La porta 3000 è già occupata. Opzioni:
1. Termina il processo che usa la porta 3000
2. Cambia porta: `PORT=3001 npm start`

## 📞 Supporto

Per problemi o domande:
1. Controlla i log del server nel terminale
2. Verifica che tutte le dipendenze siano installate (`npm install`)
3. Prova a riavviare il server

## 📝 Licenza

Questo progetto è fornito "così com'è" senza garanzie di alcun tipo.

---

**Buon lavoro con gli ordini! 🌸**

