# Optimierungen

Stand nach dem Wechsel auf die native Kotlin-App (0.5.0). Zahlen stammen aus Messungen in diesem Projekt; Schätzungen sind als solche gekennzeichnet.

## Kotlin-Rewrite (0.5.0)

Die Preact-Oberfläche in der Capacitor-WebView ist durch eine native App in Kotlin mit Jetpack Compose und Material 3 Expressive ersetzt. Das Convex-Backend und die Datenformate bleiben gleich.

| | 0.4 (WebView) | 0.5 (Kotlin) |
| --- | --- | --- |
| Release-APK | 0,95 MB | 1,9 MB (R8, ohne Play-Dienste) |
| Darstellung | WebView, etwa 65 ms je Bild auf dem Emulator | Compose, kein WebView-Sockel |
| Erinnerungen | Capacitor-Plugin, nach Neustart weg | `AlarmManager`, nach Neustart und Update wiederhergestellt |
| Standort | Browser-Geolocation | Android `LocationManager`, ohne Google-Dienste |
| Daten des Nutzers | localStorage | JSON-Dateien im App-Speicher, gleiche Formate; einmalige Übernahme aus der alten WebView |

Eine Messung auf echtem Gerät steht weiterhin aus.

## Vergleich: neue App, alte App, DB Navigator

Gemessen am 19.11.2026 auf dem Emulator (Android 16, Pixel-8-Maße, Software-Grafik), Strecke Stuttgart Hbf → Heilbronn Hbf, je 5 Runden, Median. Alle Apps vorher mit `speed-profile` kompiliert (so stehen sie auch nach Androids nächtlichem Optimierungslauf da).

Gemessen wird bei allen drei Apps gleich, von außen: Bildschirmaufnahme mit eingeblendeten Berührungen. Die Zeit läuft vom Bild, in dem der Finger landet, bis das Bild steht (`scripts/visual-bench.py`). Der Kaltstart ist Androids eigene Zeit bis zum ersten Bild (`am start -W`).

| Ablauf | Nahfahrt 0.5 (Kotlin) | Nahfahrt 0.4 (WebView) | DB Navigator 26.20 |
| --- | --- | --- | --- |
| Kaltstart bis erstes Bild | 1,35 s, das Bild ist die fertige Startseite | 1,20 s, das Bild ist nur das statische HTML-Gerüst | 3,18 s |
| Suchen bis Ergebnis steht | 0,14 s (gespeicherte Ergebnisse sofort, frische Daten kommen nach) | 0,50 s | 0,60 s |
| Verbindung öffnen | 0,11 s | 0,23 s (frühere Messung) | 0,13 s |
| Stationssuche öffnen | im selben Bild wie die Berührung | 0,37 s | 0,19 s |
| „Heil“ tippen bis Treffer steht | 1,40 s | 1,57 s | 2,08 s |
| Daten pro Suche (gesendet + empfangen) | 1,6 KB | 9,5 KB | 121 KB |

Beim Tippen sind etwa 1,2 s die Eingabe selbst über adb; der Unterschied zwischen den Apps steckt im Rest.

Aus der Messung folgten in 0.5 noch drei Änderungen:

- **Keine Aufklapp-Animation bei Verbindungen:** Mit der federnden Expressive-Animation brauchte das Öffnen 0,28 s und war langsamer als bei DB Navigator. Ohne sie steht das Ergebnis im nächsten Bild.
- **Baseline Profile:** `android/app/src/main/baseline-prof.txt` stammt aus dem ART-Profil der echten Nutzung auf dem Emulator (`scripts/profile-from-device.py`). Bei vorkompilierten Apps ändert es kaum etwas; es hilft vor allem direkt nach der Installation, bevor Android die App optimiert hat.
- **Start und Ziel bleiben erhalten:** Wie bei DB Navigator steht die letzte Suche nach einem Neustart wieder in der Maske.

## Review der Runde 0.4 und was daraus wurde

| Befund in 0.4 | In 0.5 |
| --- | --- |
| Der Aktualisieren-Knopf lieferte 60 s lang die zwischengespeicherte Antwort. | Aktualisieren fragt immer neu (`fresh`); nur eine Anfrage, die gerade unterwegs ist, wird mitgenutzt. |
| Vorgeladene Ergebnisse landeten nicht im Offline-Speicher. | Jede Antwort, auch die vorgeladene, wird für die Strecke gespeichert. |
| Die Vorabsuche 400 ms nach der Zielwahl verbrauchte das gemeinsame Tageslimit von 700 Suchen auch dann, wenn danach etwas geändert wurde. | Die Suche startet beim Berühren des Knopfs (bzw. einer Strecke). Das bringt rund 100 ms Vorsprung, und fast nie eine überflüssige Anfrage. |
| Nach jeder Suche wurden bis zu zwei Fahrtverläufe vorgeladen, auch im Mobilfunk. | Nur wenn eine Verbindung aufgeklappt wird, und nur im WLAN. |
| Zwischenspeicher zählte die Frist ab dem Start der Anfrage. | Die Frist läuft ab der Antwort. |

## Neue Optimierungen

- **Verbindung vorwärmen:** Beim Start öffnet die App mit einer `OPTIONS`-Anfrage die Verbindung zum Backend. DNS, TCP und TLS liegen damit nicht mehr vor der ersten Suche. Im Mobilfunk sind das geschätzt 100–300 ms.
- **Backend: Kontingent und Abfrage parallel:** Bisher wartete jede Suche erst auf den Schreibvorgang des Tageszählers und fragte dann Transitous. Solange das Kontingent klar nicht knapp ist, laufen beide jetzt nebeneinander. Das spart den größten Teil des Backend-Aufschlags von etwa 50 ms. In Grenznähe fragt das Backend wieder zuerst. Das öffentliche Limit wird höchstens um die wenigen Anfragen überschritten, die gerade laufen.
- **Start:** Die Daten der Startseite werden in `Application.onCreate` auf einem Hintergrund-Thread gelesen, während das Fenster aufgeht. Der Splash endet ohne Icon-Animation, das Profil-Installationsmodul ist eingebunden.

## Offen

- [ ] Messung auf einem echten Gerät: Kaltstart, Tipp bis Ergebnis, Verbindung öffnen.
- [ ] Baseline Profile nach größeren Änderungen neu aufnehmen (`scripts/profile-from-device.py`).
- [ ] Frische Suche ohne gespeicherte Ergebnisse getrennt messen (Netz plus Darstellung).
- [ ] Serverseitiger Cache für reine Haltestellensuchen (keine Adressen, keine Koordinaten), 30 Tage.
- [ ] Oberste gemerkte Strecke beim Start vorladen, gedrosselt und nur im WLAN.
- [ ] Optional: Fahrtverläufe gemerkter Verbindungen mit Glocke im Hintergrund per WorkManager aktualisieren, damit Erinnerungen auch bei geschlossener App mit Verspätungen mitwandern.

## Bewusst nicht gemacht

| Punkt | Begründung |
| --- | --- |
| Server-Cache für Verbindungssuchen und Adressen | Verbindungssuchen verraten Aufenthaltsorte und Gewohnheiten, Adressen sind personenbezogen. |
| Eigener Proxy in Frankfurt | Spart etwa 30–60 ms, kostet dauerhaften Betriebsaufwand. |
| OkHttp oder Retrofit | Androids eingebautes `HttpURLConnection` kann gzip und Keep-alive; eine Bibliothek würde die APK für wenige Millisekunden vergrößern. |
