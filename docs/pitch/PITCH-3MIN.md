# UMATE: 3 dəqiqəlik pitch (ingiliscə)

Danışılan mətnlər **ingiliscədir** (sitat kimi verilib). Səhnə göstərişləri komanda üçün Azərbaycancadır.
Saniyələr təxminidir: iki dəfə saatla məşq edin və lazım gəlsə cümlələri qısaldın.

## Rollar

| Kim | Rol | Nə edir |
|---|---|---|
| A | **Danışan** | Bütün mətni danışır, münsiflərə baxır |
| B | **Pilot** | VR box-u taxır və öyrənəni oynayır. Marşrutu əzbər bilməlidir |
| C | **Operator** | Laptopda panel (proyektorda) ilə işləyir; münsifə "Card not read" düyməsini basdırır, sonda "Progress and report" pəncərəsini açır |
| D | **Ehtiyat** | İkinci telefon hazır, ehtiyat video hazır, vaxtı izləyir (2:00 və 2:45-də işarə verir) |

## Ssenari

### 0:00–0:20 · Problem (A)

> "Imagine Aysel. She's seventeen, autistic, and she wants to take the metro from Koroğlu to 28 May.
> Four stops. The one time she tried alone, the turnstile flashed red, and she went home.
> For many young people with cognitive differences, one moment like that ends independent travel."

### 0:20–0:40 · Həll (A)

> "UMATE lets her rehearse that exact trip first: safely, as often as she needs, with her own phone in a
> low-cost VR box. Real Baku Metro stations, real BakıKart payment, and a voice AI buddy at her side."

C: proyektorda panel açıqdır, B artıq VR-dadır (vestibüldə).

### 0:40–1:50 · Canlı demo (A danışır, B oynayır, C idarə edir)

| Vaxt | B (Pilot) edir | A deyir |
|---|---|---|
| 0:40 | Terminala baxır → "Hold card" → **1 AZN** | "Our teammate is the learner now. On the screen you see exactly what she sees. First she tops up her BakıKart. A ride costs 0.60 manat, the real fare." |
| 0:55 | C münsifə yaxınlaşır: *"Please press Card not read."* Münsif basır. B turniketə baxır → **qırmızı** | "Real life goes wrong, so here the judge just made her card fail." |
| 1:02 | AI sakitləşdirir; B yenidən baxır → **yaşıl**, yerdəki dairəyə baxıb platformaya keçir | "The buddy keeps her calm. She tries again, and she's through." |
| 1:12 | Platformada 2–3 saniyə gözləyir. C **Give a hint** basır → düzgün lövhə işıqlanır. B **sol lövhəni** seçir | "If she hesitates, help grows step by step: first words, then the right sign glows. Asking the buddy counts as a good choice, not a mistake." |
| 1:25 | Qatar gəlir; vaqonda elanları dinləyir (**Short ride** açıqdır, təxminən 25 s) | "On the train she listens for her station…" |
| 1:45 | 28 May-da qapıya baxır → düşür → **xülasə** ekranı | "…and gets off at 28 May. Trip done." |

### 1:50–2:20 · Data və AI (A; C "Progress and report" pəncərəsini açır, NÜMUNƏ 03 artıq seçilib)

> "Every step is logged. Trainers see progress over weeks: steps done alone, hints and mistakes, next to
> a sample cohort that is clearly labelled NÜMUNƏ, invented, not evidence. One click, and Gemini writes
> the trainer's note from these numbers. The station data comes from OpenStreetMap, and the whole
> pipeline is open on GitHub."

### 2:20–2:45 · Biznes və növbəti addımlar (A)

> "Rehabilitation centres and inclusive schools pay a yearly licence: UMATE saves trainer time and gives
> them progress reports. Families use it for free. Next: a pilot with a centre in Baku, an Azerbaijani
> voice, and a readiness model trained on VR sessions and real-trip outcomes."

### 2:45–3:00 · Sonluq (A)

> "Practise the metro in VR first. Then go alone. We are Team Artemis, and this is UMATE.
> Judges, the headset is yours."

## Pitch-dən əvvəl yoxlama siyahısı

**Gecə əvvəl**
- [ ] Hər iki telefon və powerbank tam doludur, VR box-un linzaları tənzimlənib.
- [ ] B marşrutu 5 dəfə ardıcıl xətasız keçir (Short ride açıq).
- [ ] D ehtiyat videonu çəkib (aşağıdakı siyahı), həm laptopda, həm telefonda saxlayıb.
- [ ] `npm run voice:gen`: çatışmayan 2 səs yazılıbsa, yaxşıdır; yazılmayıbsa telefon öz səsi ilə deyir.

**Səhnədən 45 dəqiqə əvvəl** (pulsuz ictimai link 60 dəqiqə yaşayır)
- [ ] Laptopu elektrikə qoşun; `npm start`; terminalda "PUBLIC link" sətrini görün.
- [ ] Proyektor: Windows **Duplicate** rejimi; panel `https://localhost:8443/panel/`, brauzer tam ekran (F11).
- [ ] Telefonda paneldəki QR-ı skan edin → **Enter site** → **Start (VR)**. Paneldə "Buddy ready" görünməlidir.
- [ ] Paneldə **Learner: Demo (judge)**, **Short ride** açıq.
- [ ] **Progress and report** → NÜMUNƏ 03 → **Write trainer report** → hesabat çıxanda **Close**. Pitch zamanı yenidən açanda hesabat orada olacaq.
- [ ] Telefon səsi maksimum, "Narahat etməyin" rejimi açıq.
- [ ] Ehtiyat telefon da eyni addımlarla start ekranında gözləyir.

**Səhnəyə çıxmazdan dərhal əvvəl**
- [ ] C: **Restart trip** → B vestibüldə, düz turniketlərə baxır (lazım gəlsə **Recenter view**).

## Bir şey alınmasa

| Problem | Nə edirik | Kim |
|---|---|---|
| AI danışmır (internet və ya kredit) | Heç nə: yazılmış səslər avtomatik işə düşür. Davam edin | — |
| Telefon donub / qara ekran | Paneldə **Reload phone**; 10 saniyədə düzəlmirsə, ehtiyat telefon | C, D |
| İctimai link açılmır | Laptop və telefonları telefon hotspot-una qoşun, Wi-Fi linkindən istifadə edin (sertifikat əvvəlcədən quraşdırılmalıdır) | C |
| Görüntü yana sürüşüb | **Recenter view** | C |
| Hamısı alınmır | Ehtiyat videonu açın, A mətni eyni qaydada davam etdirir | D |

## Ehtiyat video (60 saniyə) üçün çəkiliş siyahısı

Ekranı **panel** ilə birlikdə yazın (Windows: `Win + Alt + R` və ya OBS). Telefon görüntüsü paneldə artıq var.

1. 0–10 s: vestibül, terminalda 1 AZN.
2. 10–20 s: "Card not read" düyməsi → qırmızı → AI sakitləşdirir → ikinci cəhd yaşıl.
3. 20–30 s: platforma, ipucu ilə lövhə işıqlanır, sol lövhə.
4. 30–50 s: vaqon, marşrut ekranı, elan, 28 May-da düşmək, xülasə.
5. 50–60 s: "Progress and report" pəncərəsi və Gemini hesabatı.

## Q&A: qısa cavablar (ingiliscə)

**Will skills from VR transfer to the real metro?**
> "That is the weakest point in the research, so we don't treat VR success as a certificate. We train
> the learner's own route with real station photos, and the trainer records real-trip outcomes."

**Is the progress data real?**
> "The live session you just saw is real. The multi-week chart uses a sample cohort labelled NÜMUNƏ,
> invented, until a pilot gives us real data."

**What if there is no internet?**
> "VR, the panel and the logs run on the laptop. Only the live AI voice needs the internet; without it
> the buddy uses recorded lines."

**Can the AI give wrong directions?**
> "The buddy only gets facts from our scenario engine, which decides what is right. It is told never to
> invent stations or prices, and the trainer sees every word."

**Privacy: children's voices and OpenAI?**
> "The microphone opens only when the learner looks at the buddy. No audio is stored, only text on the
> trainer's laptop. A real product needs guardian consent and offers a mode with recorded lines only."

**Motion sickness, sensory overload, panic?**
> "No smooth movement, only fades between places. The learner sits, sessions are two to three minutes,
> and the trainer has a calm-down button. The learner can take the phone out at any moment."

**How is this different from Floreo or Changefied?**
> "They prove the demand. We train the local route and BakıKart payment, including payment problems,
> on a phone in a cheap VR box, and a trainer can trigger problems live."

**Did you build this yourselves?**
> "Yes. The code is public on GitHub with its full history: every change went in through a pull request
> during the camp. We used AI coding assistants openly; the product decisions, the data and the testing
> are ours."

**Who pays?**
> "Centres and schools, for trainer time saved and progress reports. Families use it for free. We will
> test the price in the pilot."
