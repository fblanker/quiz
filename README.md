# Quizzy – live quiz in Kahoot-stijl

Een host maakt een quiz, spelers doen mee met een pincode via hun telefoon of laptop.
Spelers hebben **geen account** nodig. Eén dependency (`ws`), geen database.

## Lokaal starten

```bash
npm install
HOST_PASSWORD=kies-een-wachtwoord npm start
```

Open daarna http://localhost:8080

- **Spelers:** pincode + naam invullen op de startpagina.
- **Host:** klik onderaan op *Quiz hosten*, log in met het host-wachtwoord, maak je vragen en druk op *Start spel*.

Zonder `HOST_PASSWORD` verzint de server een tijdelijk wachtwoord en toont dat in de console.

## Instellingen (omgevingsvariabelen)

| Variabele | Betekenis | Standaard |
|---|---|---|
| `HOST_PASSWORD` | Wachtwoord om te kunnen hosten | willekeurig (zie console) |
| `PORT` | Poort van de server | 8080 |
| `DATA_DIR` | Map waar de opgeslagen quiz staat (`quiz.json`) | `./data` |
| `MAX_PLAYERS` | Maximaal aantal spelers per spel | 300 |
| `ALLOWED_ORIGIN` | Alleen verbindingen vanaf deze origin toestaan, bv. `https://quiz.jouwdomein.nl` | uit |

## Online zetten

Je hebt een host nodig die Node.js (18+) en WebSockets ondersteunt. Gewone WordPress- of
shared-hosting werkt meestal **niet**. Goede opties:

- **Render, Railway, Fly.io of een eigen VPS:** koppel de map of een Git-repo, startcommando `npm start`,
  zet `HOST_PASSWORD` als omgevingsvariabele. Deze diensten geven je automatisch https.
- **Docker:** `docker build -t quizzy .` en `docker run -p 8080:8080 -e HOST_PASSWORD=... quizzy`
- **VPS met nginx:** zet de app achter een reverse proxy met https en geef WebSocket-headers door:

```nginx
location / {
  proxy_pass http://127.0.0.1:8080;
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-For $remote_addr;
}
```

Wil je het op een subdomein van je eigen site, zoals `quiz.jouwdomein.nl`? Laat het subdomein
met een A- of CNAME-record naar de server wijzen.

## Goed om te weten

- **Eén instantie:** lopende spellen staan in het geheugen van de server. Draai dus één proces
  en let op dat een herstart lopende spellen wist. De opgeslagen quiz blijft wel bewaard.
- **Eerlijk spel:** tijd, punten en het goede antwoord worden op de server bepaald. Spelers
  krijgen het goede antwoord pas te zien nadat de vraag is afgelopen.
- **Opnieuw verbinden:** valt de verbinding van een speler of host weg (bijvoorbeeld door een
  telefoon die in slaap valt), dan herstelt de pagina zichzelf met dezelfde naam en score.
- **Punten:** goed antwoord = 500 tot 1000 punten, hoe sneller hoe meer.
- **Beveiliging:** gebruik altijd https en een sterk `HOST_PASSWORD`. Na 5 foute pogingen wordt
  inloggen 10 minuten geblokkeerd.
