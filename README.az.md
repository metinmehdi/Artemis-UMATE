# UMATE: metronu əvvəlcə VR-da məşq et, sonra özün get

**Team Artemis** · YUNEX 2026, Digital Inclusion treki · [English](README.md)

UMATE koqnitiv fərqliliyi olan gənclər üçün telefon və ucuz VR box ilə işləyən məşq tətbiqidir.
Gənc real Bakı metrosu səfərini, BakıKart ödənişi ilə birlikdə, real görünən 360° səhnələrdə məşq
edir. Yanında səsli AI yoldaş olur. Müəllim hər addımı laptopda canlı izləyir və lazım olan anda real
həyatdakı çətinliklərdən birini əlavə edir.

Ətraflı izah [README.md](README.md)-dədir (ingiliscə): məqsəd, hekayə, arxitektura, data mənbələri,
data modeli, testlər. Tam konsepsiya: [docs/UMATE-concept-AZ.pdf](docs/UMATE-concept-AZ.pdf).

## Necə işləyir (qısaca)

1. Gənc səfərin 4 addımını baxışla edir: kartı artırmaq → turniketdən keçmək → düzgün istiqamətin
   lövhəsini seçmək → düzgün stansiyada düşmək.
2. İlişsə, kömək pillə-pillə artır: əvvəl səsli və yazılı ipucu verilir, sonra hədəf işıqlanır. AI-a
   baxıb kömək istəmək səhv sayılmır.
3. Münsif laptopdan 4 çətinlikdən birini seçir: balans çatmır, kart oxunmur, qatar gecikir, izdiham
   və səs-küy.
4. Hər hərəkət log-a yazılır, müəllim inkişafı görür.

**Data:** stansiyalar və xətlər OpenStreetMap-dən götürülür (raw → silver qatları). Gediş haqqı
(**0.60 AZN**, 1 oktyabr 2025-ci ildən) Rəqəmsal İnkişaf və Nəqliyyat Nazirliyinin elanından
yoxlanılıb. **NÜMUNƏ** etiketli data uydurmadır və sübut kimi təqdim edilmir.

## İşə salmaq (laptop)

```powershell
cd C:\Users\metin\Desktop\YUNEX
copy .env.example .env      # sonra .env faylına OPENAI_API_KEY və GEMINI_API_KEY yazın
npm install                 # yalnız ilk dəfə
npm start
```

Server işə düşəndə terminalda linkləri göstərir. Real Wi-Fi ünvanı, yəni `192.168...` ilə başlayan
ünvan, siyahıda birinci olur.

- **Panel (proyektor):** `https://localhost:8443/panel/`
- **Telefon (tövsiyə olunur): ictimai link.** `npm start` pulsuz tunel açır və terminalda
  `https://…/k/<açar>` linkini yazır. Paneldəki QR kod avtomatik bu linkə keçir. Bu link
  istənilən şəbəkədən, hətta mobil internetdən işləyir, telefona heç nə quraşdırmaq lazım deyil.
  `<açar>` hər başlanğıcda yenidən yaranır; açarsız ünvan açılmır.
  - `tools/bin/cloudflared.exe` varsa, Cloudflare istifadə olunur: ən sürətli variantdır, vaxt limiti yoxdur.
  - Yoxdursa, Pinggy istifadə olunur. Telefonda bir dəfə **Enter site** basmaq lazımdır. Link
    60 dəqiqə işləyir, sonra yeni link və yeni QR çıxır. Ona görə serveri demodan bir az əvvəl başladın.
- **Eyni Wi-Fi-da (ehtiyat, internetsiz işləyir):** `https://<laptop-ip>:8443/vr/`. Bu halda
  sertifikat lazımdır, aşağıya baxın. Bəzi tədbir Wi-Fi-ları telefonla laptopun əlaqəsini bloklayır;
  o zaman hər iki cihazı bir telefonun hotspot-una qoşun.

> Windows server üçün firewall icazəsi istəsə **Allow** basın. Hotspot şəbəkəsi çox vaxt "Public"
> kimi tanınır, ona görə həm **Private**, həm də **Public** şəbəkələrini seçin.

**İnternet olmasa:** VR, panel, ipucları (tapşırıq kartında yazılı göstərilir), çətinliklər və log
işləyir. Yalnız AI-ın səsi işləmir.

## Telefonu ilk dəfə qoşmaq (hər telefonda bir dəfə)

1. Telefon və laptop eyni Wi-Fi şəbəkəsinə və ya hotspot-a qoşulur.
2. Telefonda `http://<laptop-ip>:8080/` ünvanını açın və sertifikatı quraşdırın. Addımlar həmin
   səhifədə yazılıb.
3. iPhone-da tam ekran üçün Safari-də **Paylaş → Ana ekrana əlavə et** seçin və tətbiqi ana ekrandakı
   ikonla açın.

## VR-da idarəetmə

| Hərəkət | Necə edilir |
|---|---|
| Ətrafa baxmaq | Başınızı çevirin (giroskop) |
| Seçmək | Obyektə 1.5 saniyə baxın. Box-un düyməsi, ekrana toxunuş və ya pult dərhal seçir |
| Yerimək | Yerdəki yaşıl dairəyə baxın |
| AI ilə danışmaq | Parlayan kürəyə baxın. Halqa işıqlananda danışın. 1.5 saniyə baxmaq həm də kömək istəmək sayılır |
| Görüntünü mərkəzə gətirmək | Paneldə **Recenter view** düyməsi və ya klaviaturada `R` |

## Panel

- **Yuxarıda:**
  - **Learner** sahəsində məşq edən gənc seçilir. **Add learner** düyməsi ilə yeni profil əlavə olunur;
    real adlar yalnız laptopda saxlanır və GitHub-a getmir.
  - **Progress and report** proqres qrafikini və müəllim hesabatını açır.
  - QR koda klik edəndə o böyüyür.
- **Sağ sütunda səfər metro xətti kimi göstərilir:** hər addım bir stansiyadır. Bitən addım yaşıl
  olur, yanında vaxt və alınan kömək yazılır; indiki addım yanıb-sönür.
- **Challenges for the judge:** 4 çətinlik. Birinci klik çətinliyi açır, ikinci klik bağlayır. Aktiv
  çətinlik narıncı rənglə görünür.
- **Trainer:**
  - **Give a hint:** növbəti pillə ipucunu verir.
  - **Calm the learner** və **Buddy says hello:** AI yoldaşı danışdırır.
  - **Recenter view:** görüntünü yenidən mərkəzə gətirir.
  - **Restart trip:** səfəri əvvəldən başladır.
  - **Reload phone:** telefondakı səhifəni yeniləyir.
- **Progress and report:** gəncin hər seansda neçə addımı köməksiz etdiyini göstərir və onu NÜMUNƏ
  ortalaması ilə müqayisə edir (qırıq xətt, "invented sample" yazısı ilə). Altında hazırlıq qaydası,
  növbəti məşq ediləcək addım və **Write trainer report** düyməsi var. Hesabatı Gemini yazır; internet
  olmasa, şablon hesabat çıxır.

## Testlər və data

```powershell
npm test               # 34 test: stansiya cütləri, 4 çətinlik, balans qaydası, data, analitika
npm run check          # bütün JavaScript fayllarının sintaksis yoxlaması
npm run data:ingest    # OpenStreetMap-dən təzə data (internet lazımdır)
npm run data:build     # network.json-u yenidən qurur (internet lazım deyil)
npm run data:sample    # NÜMUNƏ kohortunu yaradır (uydurma data, hər sətirdə "sample": true)
npm run data:gold      # star schema cədvəllərini data/gold/ qovluğuna yazır (JSON + CSV)
```

## Telefonda yoxlanılacaq siyahı

- [ ] Android: giroskop, stereo görüntü, baxışla seçim, yaşıl dairə ilə keçid
- [ ] iPhone: eyni yoxlamalar, üstəlik "Motion" icazəsi
- [ ] AI yoldaş: kürəyə baxanda mikrofon açılır, AI ingiliscə cavab verir (hər iki telefonda)
- [ ] AI-ın səsi telefonun dinamikindən kifayət qədər ucadır (iPhone-da səs qulaqlıq dinamikinə keçməməlidir)
- [ ] Panel telefonun baxışını canlı göstərir
- [ ] Paneldən 4 çətinliyin hər biri telefonda görünür
- [ ] İpucu: 8 saniyə gözləyəndə kartda ipucu çıxır, 15 saniyədən sonra hədəf işıqlanır
