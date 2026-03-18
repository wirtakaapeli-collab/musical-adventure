# AsterDex Auto Bot

Node.js-pohjainen AsterDex-sijoitusbotti, jossa on:

- paper trading / live trading toggle
- sisäänrakennettu frontend samalla domainilla
- kirjautuminen tunnuksilla `Olli` / `011100`
- automaattinen strategia (EMA + RSI + MACD + ATR + volume filter)
- riskinhallinta (max capital, TP, SL, trailing stop)
- API-avainten tallennus backendiin
- start / stop / reset -hallinta

## Käynnistys

```bash
npm install
npm start
```

Avaa sitten `http://localhost:3000`.

## Live trading

1. Kirjaudu sisään.
2. Aseta `paperTrading` arvoon `false`.
3. Syötä AsterDex API key + secret.
4. Tallenna asetukset.
5. Paina `Start`.

> Huom: live-kauppa käyttää AsterDex futures-tyylisiä REST-endpointteja. Tarkista aina omalta tililtäsi API-oikeudet, symbolit, vipu ja tuotantoympäristön yhteensopivuus ennen oikean rahan käyttöä.
