# 🚀 Deploy su Railway.app - Guida Completa

Questa guida ti spiega passo-passo come deployare l'app Ordini Fiori su Railway.app per usarla dal telefono ovunque, senza tenere il computer acceso.

---

## 📋 Prerequisiti

- Account GitHub (gratuito)
- Account Railway.app (gratuito)
- Progetto ordini-fiori pronto

---

## 🎯 Parte 1: Preparare il Repository GitHub

### Step 1: Crea un repository su GitHub

1. Vai su **https://github.com**
2. Clicca sul pulsante **"New"** (o "+")
3. Nome repository: `ordini-fiori`
4. Lascia **Public** o **Private** (Railway funziona con entrambi)
5. **NON** aggiungere README, .gitignore o licenza (abbiamo già tutto)
6. Clicca **"Create repository"**

### Step 2: Carica il progetto su GitHub

Apri il terminale nella cartella `ordini-fiori` e esegui:

```bash
# Inizializza git (se non già fatto)
git init

# Aggiungi tutti i file
git add .

# Fai il primo commit
git commit -m "Deploy ready: ordini fiori app"

# Collega al repository GitHub
git remote add origin https://github.com/TUO-USERNAME/ordini-fiori.git

# Carica su GitHub
git branch -M main
git push -u origin main
```

⚠️ **Sostituisci `TUO-USERNAME`** con il tuo username GitHub!

---

## 🚂 Parte 2: Deploy su Railway

### Step 1: Crea account Railway

1. Vai su **https://railway.app**
2. Clicca **"Login"**
3. Scegli **"Login with GitHub"**
4. Autorizza Railway ad accedere a GitHub

### Step 2: Crea nuovo progetto

1. Nella dashboard Railway, clicca **"New Project"**
2. Scegli **"Deploy from GitHub repo"**
3. Seleziona il repository **`ordini-fiori`**
4. Railway inizierà automaticamente il deploy

### Step 3: Configura le variabili d'ambiente

1. Clicca sul **service** appena creato (si chiama come il repo)
2. Vai alla tab **"Variables"**
3. Clicca **"New Variable"**
4. Aggiungi:
   ```
   Nome: DATABASE_PATH
   Valore: /data
   ```
5. Clicca **"Add"**

### Step 4: Crea il Volume per persistenza dati

⚠️ **IMPORTANTE**: Senza volume, il database e le foto si cancellano ad ogni deploy!

1. Nella dashboard del progetto, clicca **"+ New"**
2. Seleziona **"Volume"**
3. Nome volume: `ordini-data`
4. Clicca **"Add Volume"**
5. Ora **collega il volume al service**:
   - Clicca sul **service** (non sul volume)
   - Vai alla tab **"Settings"**
   - Scorri fino a **"Volumes"**
   - Clicca **"Mount Volume"**
   - Seleziona il volume `ordini-data`
   - Mount Path: `/data`
   - Clicca **"Add Mount"**

### Step 5: Configura il dominio pubblico

1. Nel service, vai alla tab **"Settings"**
2. Scorri fino a **"Networking"**
3. Clicca **"Generate Domain"**
4. Railway genererà un URL tipo: `https://ordini-fiori-production-XXXX.up.railway.app`

### Step 6: Riavvia il service

1. Vai alla tab **"Deployments"**
2. Clicca sui tre puntini dell'ultimo deployment
3. Seleziona **"Redeploy"**

---

## ✅ Verifica che Funzioni

### Test 1: Controlla i log

1. Nella tab **"Deployments"**
2. Clicca sull'ultimo deployment
3. Dovresti vedere:
   ```
   📊 Database path: /data/ordini.db
   📸 Serving uploads from volume: /data/uploads
   ✓ Database inizializzato
   🌸 Server ordini fiori avviato!
   ```

### Test 2: Apri l'app dal browser

1. Copia l'URL generato (es: `https://ordini-fiori-production-XXXX.up.railway.app`)
2. Aprilo nel browser (computer o telefono)
3. Dovresti vedere la pagina di login!

### Test 3: Fai login e crea un ordine

1. Username: **Massimo** (o uno degli altri)
2. Password: **1234**
3. Crea un ordine di test
4. Verifica che funzioni tutto

---

## 📱 Installa sul Telefono

### iPhone (Safari)

1. Apri l'URL Railway in **Safari**
2. Tocca l'icona **"Condividi"** (quadrato con freccia)
3. Scorri e tocca **"Aggiungi a Home"**
4. Tocca **"Aggiungi"**
5. L'app appare sulla schermata home! 🎉

### Android (Chrome)

1. Apri l'URL Railway in **Chrome**
2. Tocca il menu **(⋮)** in alto a destra
3. Seleziona **"Aggiungi a schermata Home"**
4. Tocca **"Aggiungi"**
5. L'app appare sulla schermata home! 🎉

---

## 🔄 Aggiornamenti Futuri

Quando modifichi il codice in futuro:

```bash
# Fai le modifiche ai file
# Poi:

git add .
git commit -m "Descrizione modifiche"
git push

# Railway fa il redeploy automaticamente! 🚀
```

---

## 💰 Limiti Piano Gratuito Railway

- **$5 di credito mensile** (circa 500 ore di server acceso)
- Se finisci i crediti, il server si spegne fino al mese successivo
- Per monitorare l'uso: Dashboard Railway → **"Usage"**

### Se finisci i crediti prima di fine mese:

**Opzione 1**: Aggiungi carta di credito (Railway addebita solo l'uso effettivo, circa €5-10/mese)

**Opzione 2**: Usa [Render.com](https://render.com) (gratis per sempre, ma server va in sleep dopo 15min)

---

## 🛠️ Risoluzione Problemi

### ❌ Deploy fallito

**Controlla i log:**
- Railway → Deployments → Clicca sul deployment fallito
- Leggi l'errore nei log

**Errori comuni:**
- Mancano dipendenze: verifica `package.json`
- Node version troppo vecchia: Railway usa l'ultima stabile

### ❌ Database si resetta ad ogni deploy

**Causa**: Volume non montato correttamente

**Soluzione:**
1. Verifica che il volume sia montato su `/data`
2. Verifica che la variabile `DATABASE_PATH=/data` sia impostata
3. Controlla i log: deve apparire `📊 Database path: /data/ordini.db`

### ❌ Foto non si caricano

**Causa**: Volume non persistente

**Soluzione**: Stessa del problema database (verifica volume montato)

### ❌ App lenta

**Causa**: Server in regione lontana

**Soluzione:**
1. Railway → Settings → Region
2. Cambia in **Europe West** (se sei in Europa)

---

## 🎉 Congratulazioni!

La tua app è online e accessibile da qualsiasi dispositivo con internet!

**URL da condividere:**
```
https://ordini-fiori-production-XXXX.up.railway.app
```

Salvalo o condividilo con i colleghi! 🌸

---

## 📞 Supporto

- **Railway Docs**: https://docs.railway.app
- **Railway Discord**: https://discord.gg/railway

---

**Ultimo aggiornamento**: Gennaio 2025

