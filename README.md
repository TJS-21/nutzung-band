# Nutzungsleiste für Claude Code

Zeigt direkt über dem Eingabefeld:

- **5 Std** – Verbrauch des 5-Stunden-Kontingents und wann es zurückgesetzt wird
- **Woche** – Verbrauch des Wochenkontingents und wann es zurückgesetzt wird
- **Chat** – wie voll der Gesprächsspeicher der aktuellen Unterhaltung ist

Jeder Wert ist ein schmaler Balken: dunkelgrau die Gesamtmenge, blau der Füllstand. Ab der Schwelle wird der Füllstand rot, und einmal kommt ein kurzer Hinweis: beim Gesprächsspeicher ab 70 %, beim 5-Stunden- und Wochenkontingent ab 80 %. Im Terminal sind die Balken aus Textzeichen.
Die Kontingent-Werte gibt es nur mit einem Claude-Abo. Sie erscheinen nach der ersten Antwort einer Sitzung.

## Installation

Voraussetzung: Claude Code (Terminal oder der Code-Tab der Claude-Desktop-App). Im normalen Chat und in Cowork gibt es diese Leiste nicht.

**In der Desktop-App (Code-Tab):** Plus neben dem Eingabefeld → Plugins → „Add marketplace“ → `TJS-21/nutzung-band` eingeben → danach „Add plugin“ bei **nutzung-band**.

**Im Terminal**, am Prompt von Claude Code:

```
/plugin install nutzung-band --marketplace TJS-21/nutzung-band
```

Danach die Frage zum Hinzufügen mit `y` bestätigen und den Geltungsbereich „User“ wählen.

**Aus einer Shell:**

```
claude plugin install nutzung-band --marketplace TJS-21/nutzung-band
```

Danach eine neue Sitzung starten. Die Werte erscheinen nach der ersten Antwort.

**Updates:** Die Desktop-App holt Plugin-Updates nicht von selbst. Neue Version holen mit

```
claude plugin update nutzung-band@timo-schroeder-plugins
```

Hinweis: Die zugrunde liegende Schnittstelle von Claude Code ist in einer frühen Phase und kann sich mit Updates ändern.
