# Offene Optimierungen

Arbeitsliste für alles, was nach dieser Runde noch offen ist. Zahlen stammen aus Messungen in diesem Projekt; Schätzungen sind als solche gekennzeichnet.

## In dieser Runde umgesetzt (Stufe 1 und 2)

- Vorladen der Suche bei der Zielauswahl.
- Vorladen des Fahrtverlaufs der ersten Verbindung.
- Deduplizierung gleichartiger Anfragen.
- Start-Bundle verkleinert: Live-Ansicht, Teilen und erweiterte Suche per dynamischem Import.
- `localStorage` aus dem Render-Pfad entfernt.
- Statisches Start-Skelett in `index.html`.
- Android-Splash ohne Icon-Animation.

## Messgrundlage

### Emulator, Zeit bis Bild

| Ablauf | vorher | nachher |
| --- | --- | --- |
| Tastendruck | 224 ms | 84 ms |
| Stationstreffer, Wiederholung | 345 ms | 32–58 ms |
| Teilen-Fenster | 744 ms | 600 ms |
| Teilen-Bild | 1414 ms | 609 ms |

### Sockel des Messaufbaus

| Größe | Wert |
| --- | --- |
| Ein sichtbares WebView-Bild auf dem Emulator | etwa 65 ms |
| Sichtbare Änderung | 72–96 ms |
| App-Rechnung pro Tap | 1–10 ms |

Werte unterhalb des Sockels sind auf diesem Emulator nicht messbar. Die App-Rechnung ist bereits deutlich kleiner als die Darstellung.

### Netz

Frisch gegen das Produktions-Backend gemessen, Region eu-west-1. Die Werte sind Laufzeiten ab Anfrage bis Antwort, ohne App-Rendering.

| Anfrage | Zeit | Größe |
| --- | --- | --- |
| `/v1/places` | 242 ms | 577 B |
| `/v1/journeys` | 253–262 ms | 3,2 KB (908 B gzip) |
| Transitous direkt | 190–207 ms | 181 KB (54 KB gzip) |

Das eigene Backend kostet gegenüber Transitous direkt etwa 50 ms, liefert dafür aber nur die gefilterten Felder und schützt das Tageslimit.

### Vergleich mit DB Navigator

DB Navigator 26.20.0 gegen Nahfahrt 0.3.0, gleicher Emulator, Strecke Stuttgart Hbf → Heilbronn Hbf, Median aus 5–8 Läufen.

| Ablauf | DB Navigator | Nahfahrt |
| --- | --- | --- |
| Kaltstart bis Suchmaske | 2,50 s | 2,61 s |
| Erstes Bild beim Kaltstart | 1,94 s | 0,52 s |
| Stationstreffer | 1,17 s | 0,10 s |
| Verbindung suchen | 1,51 s | 1,13 s |
| Verbindung öffnen | 0,13 s | 0,23 s |
| Fahrtverlauf | 0,23 s | 0,36 s |
| Daten beim Kaltstart | 805 KB | 0 |
| Daten pro Suche | 22,8 KB | 8,6 KB |

Nahfahrt zeigt früher ein Bild und ist bei Stationstreffer, Suche und Datenmenge schneller. Langsamer ist es beim Öffnen einer Verbindung und beim Fahrtverlauf, weil DB Navigator diese Ansichten offenbar vorbereitet bzw. lokal hält.

**Einschränkung:** Alle Werte stammen von einem Emulator mit Software-Grafik (SwiftShader). Es gibt noch keine Messung auf einem echten Gerät. Absolute Zeiten und der Abstand zwischen den Apps können dort anders aussehen.

## Offene Optimierungen

Sortiert nach Verhältnis von Wirkung zu Aufwand. Aufwand: klein = unter einem Tag, mittel = ein bis drei Tage, groß = mehr.

### a. „Verbindung öffnen“ von 3 auf 1 Bild bringen

- **Was:** Layout und Paint der Detailansicht untersuchen (Trace auswerten), `contain` und `content-visibility` für Listen und Abschnitte setzen, unnötige Layoutsprünge beim Aufbau vermeiden.
- **Erwarteter Gewinn:** etwa 130 ms auf dem Emulator, also zwei eingesparte Bilder. Auf echter Hardware entsprechend weniger.
- **Aufwand:** klein bis mittel.
- **Daten/Tageslimit:** keine Änderung.
- **Risiko:** gering. Hauptrisiko sind Layoutfehler durch `content-visibility` (falsche Höhen, Springen beim Scrollen).

### b. Serverseitiger Cache für Haltestellensuchen

- **Was:** Ergebnisse von `/v1/places` für reine Haltestellensuchen serverseitig 30 Tage speichern. Keine Adressen und keine Koordinatensuchen cachen.
- **Erwarteter Gewinn:** 242 ms auf etwa 30–50 ms bei Treffern im Cache.
- **Aufwand:** mittel (Convex-Tabelle, Schlüsselnormalisierung, Aufräumen).
- **Daten/Tageslimit:** weniger Anfragen an Transitous, also Entlastung des Tageslimits. Zusätzlicher Speicher im Backend ist gering.
- **Risiko:** Datenschutz. Die Ausnahme (nur Stopps, keine Adressen, 30 Tage) muss in der README dokumentiert werden. Veraltete Haltestellennamen sind möglich, deshalb kurze TTL und manuelles Löschen vorsehen.

### c. 60-Sekunden-Cache für Suchergebnisse auf dem Gerät

- **Was:** Ergebnisse pro Schlüssel `from|to|Minute` für 60 Sekunden im Speicher halten.
- **Erwarteter Gewinn:** Wiederholungen derselben Suche ohne Netzwartezeit, in der Größenordnung der vollen Suchdauer (rund 250 ms Backend plus Rendering).
- **Aufwand:** klein.
- **Daten/Tageslimit:** weniger Anfragen bei Wiederholungen.
- **Risiko:** Echtzeitwerte können bis zu 60 Sekunden alt sein. Nur für identische Schlüssel und nur im Vordergrund cachen.

### d. Oberste gemerkte Strecke beim App-Start vorladen

- **Was:** Die erste gemerkte Verbindung beim Start im Hintergrund laden, gedrosselt auf höchstens alle 10 Minuten.
- **Erwarteter Gewinn:** Der erste Tap auf eine gemerkte Verbindung zeigt sofort Ergebnisse statt nach etwa 250 ms Netz plus Rendering.
- **Aufwand:** klein bis mittel.
- **Daten/Tageslimit:** eine zusätzliche Suche pro Kaltstart, durch die Drosselung begrenzt.
- **Risiko:** unnötige Anfragen, wenn die App oft geöffnet, aber selten genutzt wird. Akku- und Datenverbrauch im Hintergrund beachten.

### e. Fahrtverlauf-Liste virtualisieren

- **Was:** Nur sichtbare Halte rendern, statt der gesamten Liste.
- **Erwarteter Gewinn:** kürzere Aufbauzeit und flüssigeres Scrollen bei langen Fahrten mit 50 und mehr Halten. Bei kurzen Fahrten kein Gewinn.
- **Aufwand:** mittel.
- **Daten/Tageslimit:** keine Änderung.
- **Risiko:** gering. Markierungen für den aktuellen Halt und Umstiege müssen beim Virtualisieren korrekt bleiben.

### f. Tipp-Pause 250 auf 180–200 ms senken, nur bei lokalem Treffer

- **Was:** Die Wartezeit vor einer Suche verkürzen, wenn die Eingabe bereits lokal auf eine Haltestelle passt.
- **Erwarteter Gewinn:** etwa 50 ms.
- **Aufwand:** klein.
- **Daten/Tageslimit:** etwa 15 Prozent mehr Anfragen.
- **Risiko:** höhere Last und schnelleres Erreichen des Tageslimits. Nur sinnvoll, wenn die Reserve im Limit groß genug ist.

### g. Teilen-Bild im Worker oder mit OffscreenCanvas erzeugen

- **Was:** Das Bild für die Teilen-Funktion außerhalb des Hauptthreads zeichnen.
- **Erwarteter Gewinn:** etwa 100 ms auf etwa 60 ms.
- **Aufwand:** mittel.
- **Daten/Tageslimit:** keine Änderung.
- **Risiko:** Canvas- und Font-Unterstützung im Android-WebView prüfen; Fallback auf den bisherigen Weg nötig.

### h. Nutzlast feinschleifen

- **Was:** Antwort von `/v1/journeys` von 908 B auf etwa 700 B gzip verkleinern, Spinner-Schwelle prüfen, `preconnect` zum Backend prüfen.
- **Erwarteter Gewinn:** wenige Millisekunden, vor allem bei Mobilfunk mit hoher Latenz. Der Spinner erscheint seltener unnötig.
- **Aufwand:** klein.
- **Daten/Tageslimit:** etwas weniger Bytes pro Suche.
- **Risiko:** gering. Feldnamen nur ändern, wenn die App-Version mit dem Backend zusammen ausgeliefert wird.

### Bewusst nicht gemacht

| Punkt | Begründung |
| --- | --- |
| Server-Cache für Verbindungssuchen und Adressen | Verbindungssuchen verraten Aufenthaltsorte und Gewohnheiten, Adressen sind personenbezogen. Ein Cache dafür wäre eine Datensammlung, die die App bewusst vermeidet. |
| Eigener Proxy in Frankfurt | Spart etwa 30–60 ms gegenüber eu-west-1, kostet aber dauerhaften Betriebsaufwand (Server, Ausfälle, Zertifikate, Monitoring). |
| Tipp-Pause weiter unter 180 ms senken | Der Gewinn ist klein, die Zahl der Anfragen und damit das Tageslimit steigen überproportional. |
| Nativer Komplett-Rewrite in dieser Runde | Siehe Abschnitt „Kotlin-Rewrite“. Ohne Messung auf echter Hardware ist die Entscheidungsgrundlage zu dünn. |

## Kotlin-Rewrite

### Ausgangslage

Die App ist kein React Native. Sie ist eine Preact-Anwendung, die in einer Capacitor-WebView läuft. Android-seitig gibt es nur die Capacitor-Hülle und einige Plugins.

### Vergleich

Werte für React Native und Kotlin+Compose sind Schätzungen, keine Messungen in diesem Projekt.

| Kriterium | Heute (Preact + WebView) | React Native | Kotlin + Compose |
| --- | --- | --- | --- |
| Erstes Bild | 0,52 s Kaltstart (Emulator, gemessen) | etwa 1,0–1,8 s (geschätzt) | etwa 0,6–1,0 s (geschätzt, Emulator) |
| Bedienbar | 2,61 s bis Suchmaske (Emulator, gemessen) | etwa 1,5–2,5 s (geschätzt) | etwa 0,8–1,5 s (geschätzt) |
| Tap bis Bild | 84 ms Tastendruck, 230 ms Verbindung öffnen (Emulator) | wenige Bilder, aber JS-Bridge und Startkosten | ein bis zwei Bilder, kein WebView-Sockel |
| APK-Größe | etwa 0,9 MB | 8–15 MB (geschätzt) | 4–8 MB (geschätzt) |
| Netzwerk/Daten | eigene API, Suche 8,6 KB | gleich, plus RN-Laufzeit | gleich, ohne WebView |
| Hintergrund-Erinnerungen | lokale Benachrichtigungen über Capacitor; Planung beim App-Start, Android kann verzögern | gleiche Plugin-Abhängigkeit | native `AlarmManager`/`WorkManager`, zuverlässiger planbar |
| Aufwand | erledigt | kompletter Neubau | kompletter Neubau |

### Aufwand

- 2.744 Zeilen TSX und 1.344 Zeilen CSS der Oberfläche neu schreiben.
- Etwa 1.200 Zeilen reine Logik portieren (Filter, Ranking, Fortschritt, Erinnerungsplan, Formatierung, Teilen-Text).
- Das Convex-Backend bleibt unverändert: 951 Zeilen in `convex/lib` plus die Endpunkte.
- 112 Tests neu schreiben bzw. übertragen.

Der eigentliche Aufwand liegt nicht in der Logik, sondern in der Oberfläche und in der Android-Integration (Benachrichtigungen, Dateien, Teilen, Standort).

### Wann es sich lohnt

- Kaltstart unter 300 ms ist ein hartes Produktziel.
- Erinnerungen müssen auch bei geschlossener App zuverlässig und ohne Umwege über Plugin-Grenzen funktionieren.

### Wann nicht

- Nur um auf echter Hardware 20–30 ms zu gewinnen. Dafür ist der Neubau zu teuer.
- Solange die Messung auf echtem Gerät fehlt und der WebView-Sockel dort unbekannt ist.

### Empfehlung

Erst auf einem echten Gerät messen, dann entscheiden. Wenn neu gebaut wird, dann in Kotlin mit Compose, nicht in React Native: React Native wäre ebenfalls ein kompletter Neubau, hätte aber weiterhin einen JS-Start und eine deutlich größere APK.

## Nächste Schritte

- [ ] Bench-APK auf mindestens einem echten Gerät mit GPU messen und Werte gegen die Emulator-Tabelle stellen.
- [ ] Trace der Detailansicht auswerten und „Verbindung öffnen“ auf ein Bild bringen (a).
- [ ] 60-Sekunden-Cache für Suchergebnisse einbauen (c).
- [ ] Nutzlast, Spinner-Schwelle und `preconnect` prüfen (h).
- [ ] Oberste gemerkte Strecke beim Start gedrosselt vorladen (d).
- [ ] Serverseitigen Haltestellen-Cache mit Datenschutz-Ausnahme in der README umsetzen (b).
- [ ] Tipp-Pause erst nach Prüfung des Tageslimit-Puffers anpassen (f).
- [ ] Fahrtverlauf virtualisieren, wenn lange Fahrten in der Praxis häufig sind (e).
- [ ] Teilen-Bild in den Worker verschieben, wenn die Teilen-Zeit weiter stört (g).
- [ ] Nach den echten Messwerten über den Kotlin-Rewrite entscheiden.
