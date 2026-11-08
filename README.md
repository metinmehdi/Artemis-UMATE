# UMATE: metro və ödəniş təlimi (YUNEX 2026)

Bu layihə telefon və ucuz VR box ilə Bakı metrosunda yol getməyi və BakıKart ilə ödəniş etməyi məşq etdirir. Yanında AI yoldaş olur. Laptopdakı panel proyektorda göstərilir.

## İşə salmaq (laptop)

```powershell
cd C:\Users\metin\Desktop\YUNEX
copy .env.example .env      # sonra .env faylına OPENAI_API_KEY və GEMINI_API_KEY yazın
npm install                 # yalnız ilk dəfə
npm start
```

Server işə düşəndə terminalda linkləri göstərir. Real Wi-Fi ünvanı, yəni `192.168...` ilə başlayan ünvan, siyahıda birinci olur.

- **Panel (proyektor):** `https://localhost:8443/panel/`
- **Telefon:** paneldəki QR kodu skan edin və ya `https://<laptop-ip>:8443/vr/` ünvanını açın.

> Windows server üçün firewall icazəsi istəsə **Allow** basın. Hotspot şəbəkəsi çox vaxt "Public" kimi tanınır, ona görə həm **Private**, həm də **Public** şəbəkələrini seçin.

## Telefonu ilk dəfə qoşmaq (hər telefonda bir dəfə)

1. Telefon və laptop eyni Wi-Fi şəbəkəsinə və ya hotspot-a qoşulur.
2. Telefonda `http://<laptop-ip>:8080/` ünvanını açın və sertifikatı quraşdırın. Addımlar həmin səhifədə yazılıb.
3. iPhone-da tam ekran üçün Safari-də **Paylaş → Ana ekrana əlavə et** seçin və tətbiqi ana ekrandakı ikonla açın.

## VR-da idarəetmə

| Hərəkət | Necə edilir |
|---|---|
| Ətrafa baxmaq | Başınızı çevirin (giroskop) |
| Seçmək | Obyektə 1.5 saniyə baxın. Box-un düyməsi, ekrana toxunuş və ya pult dərhal seçir |
| Yerimək | Yerdəki yaşıl ayaq izinə baxın |
| AI ilə danışmaq | Parlayan robota baxın. Halqa yaşıl olanda danışın |
| Görüntünü mərkəzə gətirmək | Paneldə **Recenter view** düyməsi və ya klaviaturada `R` |

## Paneldəki düymələr

- **Recenter view:** görüntünü yenidən düz qarşıya gətirir.
- **Buddy: say hello / calm down:** AI yoldaşı danışdırır.
- **Restart trip:** səfəri əvvəldən başladır.
- **Visual A/B:** low-poly 3D görünüşlə AI-ın yaratdığı 360° fon arasında keçid edir.
- **Reload phone:** telefondakı səhifəni yeniləyir.

## Struktur

```
server/   HTTPS + WebSocket server, OpenAI token, JSONL log
shared/   ortaq 3D səhnə (telefon və panel eyni kodu işlədir)
client/   vr/ (telefon), panel/ (proyektor), setup.html (sertifikat)
data/     sessions/*.jsonl: seans logları (git-ə düşmür)
```

## Faza 0: telefonda yoxlanılacaq siyahı

- [ ] Android: giroskop, stereo görüntü, baxışla seçim, ayaq izi ilə keçid
- [ ] iPhone: eyni yoxlamalar, üstəlik "Motion" icazəsi
- [ ] AI yoldaş: robota baxanda mikrofon açılır, AI ingiliscə cavab verir (hər iki telefonda)
- [ ] AI-ın səsi telefonun dinamikindən kifayət qədər ucadır (iPhone-da səs qulaqlıq dinamikinə keçməməlidir)
- [ ] Panel telefonun baxışını canlı göstərir
- [ ] Visual A/B: hansı görünüş daha yaxşıdır?
