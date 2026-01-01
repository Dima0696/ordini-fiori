# 🚀 Guida Rapida - Ordini Fiori

## Primi passi (una volta sola)

1. **Installa Node.js** (se non lo hai già):
   - Vai su https://nodejs.org/
   - Scarica e installa la versione LTS

2. **Installa dipendenze**:
   ```bash
   cd ordini-fiori
   npm install
   ```

## Avvio Quotidiano

### Sul Computer

1. Apri il Terminale
2. Vai nella cartella del progetto:
   ```bash
   cd ordini-fiori
   ```
3. Avvia il server:
   ```bash
   npm start
   ```
4. Vedrai un messaggio con l'indirizzo da usare sul telefono

### Sul Telefono

1. Assicurati di essere connesso alla **stessa rete Wi-Fi** del computer
2. Apri il browser (Safari o Chrome)
3. Digita l'indirizzo mostrato dal server (es. `http://192.168.1.15:3000`)
4. Salva l'app sulla home del telefono (vedi istruzioni sotto)

## 📱 Salva App sulla Home (solo la prima volta)

### iPhone
1. Tocca l'icona "Condividi" (quadrato con freccia verso l'alto)
2. Scorri e tocca "Aggiungi a Home"
3. Tocca "Aggiungi"
4. Fatto! Ora hai l'app sulla schermata principale

### Android
1. Tocca i tre puntini in alto a destra
2. Seleziona "Aggiungi a schermata Home"
3. Tocca "Aggiungi"
4. Fatto! Ora hai l'app sulla schermata principale

## 🎯 Come Usare l'App

### Vista Calendario
- Vedi tutti i giorni del mese
- I giorni con ordini hanno un pallino colorato
- Tocca un giorno per vedere gli ordini

### Vista Ordini del Giorno
- **➕ Nuovo ordine**: Crea un nuovo ordine
- **✏️ Modifica**: Cambia cliente/descrizione
- **✓ Pronto**: Segna ordine come pronto
- **✓ Ritirato**: Segna ordine come ritirato
- **🗑️ Elimina**: Cancella ordine (con conferma)

### Stati Ordine
- **Grigio** = Da preparare
- **Blu** = Pronto
- **Verde** = Ritirato

## ⚡ Risoluzione Problemi

### "Non riesco a connettermi dal telefono"
- Verifica di essere sulla stessa rete Wi-Fi
- Riavvia il server (CTRL+C e poi `npm start`)
- Prova a disattivare il firewall temporaneamente

### "Il server non parte"
- Verifica di aver eseguito `npm install`
- Controlla che la porta 3000 non sia già usata
- Riavvia il terminale e riprova

### "L'app è lenta"
- Verifica la connessione Wi-Fi
- Riavvia il server
- Chiudi e riapri l'app sul telefono

## 💡 Suggerimenti

- ✅ Lascia il server acceso quando usi l'app
- ✅ Per chiudere il server: premi CTRL+C nel terminale
- ✅ L'app funziona anche con più telefoni contemporaneamente!
- ✅ Tutti vedono gli stessi dati in tempo reale

## 📦 Backup

Per salvare i dati, copia il file `ordini.db`:

```bash
cp ordini.db backup-ordini-$(date +%Y%m%d).db
```

---

**Per maggiori dettagli, leggi README.md**
