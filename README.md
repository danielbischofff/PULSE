Erstelle eine moderne Metronom-Web-App names PULSE

Ziel:
Eine sehr präzise, minimalistische Metronom-App als Web-App, stark inspiriert vom Soundbrenner-Design: dunkler Look, großer zentraler Kreis, klare Hierarchie, runde Controls, wenige Farben, mobile-first. Keine Kopie, aber gleiche Designrichtung.

App-Sprache:
- Die komplette App-UI soll auf Englisch sein.
- Alle Labels, Buttons, Statusanzeigen und Fehlermeldungen müssen Englisch sein.

Technische Anforderungen:
- Web-App, lauffähig im Browser
- Präzises Timing mit Web Audio API, nicht nur setInterval
- Stabiler, gleichmäßiger Klick ohne hörbare Timing-Schwankungen
- Soll im Hintergrund möglichst zuverlässig weiterlaufen
- Responsive für Mobile und Desktop
- Sauber strukturierter, wartbarer Code
- Kritische Audio- und Timing-Logik kommentieren

Design-Anforderungen:
- Stark am Soundbrenner-Design orientieren
- Dunkler Hintergrund
- Nur Schwarz- und Grautöne für das UI verwenden
- Keine rote Farbe verwenden
- Keine Farbübergänge / Gradients verwenden
- Nur die Beat-Visualisierung darf Farbe haben
- Monospace-Font als primäre Design-Schrift verwenden
- Sehr schlicht, clean und aufgeräumt
- Großer zentraler Kreis / BPM-Rad im Fokus
- Große BPM-Zahl
- Runde Buttons
- Wenige sichtbare Controls
- Einstellungen klar gruppieren
- Keine überladene Oberfläche
- Mobile-first Layout

Hauptseite: Metronome
Funktionen:
- Start/Stop-Button
- BPM-Steuerung nur über:
  - großes zentrales Rad
  - direkte Zahleneingabe
  - Tap-to-BPM
- Taktart einstellen, z. B. 2/4, 3/4, 4/4, 5/4, 6/8
- Betonungen pro Beat einstellen
- Optional stärkerer erster Beat pro Takt
- Notenlänge/Subdivision einstellen: quarter notes, eighth notes, sixteenth notes, triplets
- Klick-Lautstärke regelbar
- Die maximale Lautstärke muss wirklich sehr laut sein können
- Visuelles Beat-Feedback über Puls/Kreis

Betonungs-UI:
- Keine Textlabels für einzelne Betonungen verwenden
- Betonungen visuell als Reihe von Blöcken darstellen
- Jeder Beat im Takt wird durch einen Block dargestellt
- Gefüllter Block = betonter Beat
- Ungefüllter Block = unbetonter Beat
- Antippen/Klicken eines Blocks toggelt die Betonung
- Die Blöcke sollen minimalistisch aussehen, ähnlich wie im Referenzbild
- Nur Grau-/Schwarz-Töne verwenden

Practice Page / Rhythm Training:
Erstelle eine separate Practice-Page oder einen Tab.

Das Metronom läuft in einem wiederholbaren Zyklus:
- Start Length X: Metronom plays X bars audibly
- Silence Y: Metronom is muted for Y bars
- Re-entry Z: Metronom becomes audible again after Z bars

Beispiel:
X = 4, Y = 4, Z = 1 bedeutet:
4 bars audible, 4 bars silent, then 1 re-entry bar, then the cycle repeats.

Practice Controls:
- Input fields for X, Y and Z
- Start/Stop for Practice Mode
- Display current status: Playing, Muted, Re-entry
- Display current bar inside the cycle

Qualitätspriorität:
1. Präzises Audio-Timing
2. Solide Metronom-Kernfunktionen
3. Practice-Modus
4. Design-Feinschliff

Wichtig:
Audio-Timing ist wichtiger als Animationen. Das Metronom darf beim Ändern von BPM, Taktart oder Subdivision nicht aus dem Takt springen.
Baue eine vollständige erste Version der App mit allen genannten Funktionen.