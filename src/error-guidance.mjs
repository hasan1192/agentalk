// Match only app-generated summaries. Provider response bodies never enter this UI.
export function errorGuidance(message) {
  const clean = message.replace(
    /^Error invoking remote method '[^']+': Error: /,
    "",
  );
  const status = Number(clean.match(/^Sunucu HTTP (\d{3}) döndürdü\./)?.[1]);
  if (status === 401)
    return {
      title: "API anahtarı kabul edilmedi",
      cause: "Anahtar eksik, geçersiz veya süresi dolmuş olabilir.",
      action:
        "Ayarlar → API bağlantıları bölümünden bu bağlantının anahtarını güncelle ve bağlantıyı sına.",
    };
  if (status === 403)
    return {
      title: "Bu işlem için erişim izni yok",
      cause:
        "Anahtarın seçilen modele veya projeye erişimi olmayabilir. Sağlayıcının hesap ya da bölge kısıtlamaları da buna neden olabilir.",
      action:
        "Sağlayıcı hesabındaki model ve proje izinlerini kontrol et; ardından bağlantıyı yeniden sına.",
    };
  if (status === 404)
    return {
      title: "Model veya API adresi bulunamadı",
      cause: "Sunucuya ulaşıldı ancak istenen model ya da API yolu bulunamadı.",
      action:
        "Bağlantının adresini ve API biçimini kontrol et. Model listesini yenile ve kişinin model kimliğini doğrula.",
    };
  if (status === 429)
    return {
      title: "Sağlayıcının kullanım sınırına ulaşıldı",
      cause:
        "Çok sık istek gönderilmiş veya hesabın kullanım kotası dolmuş olabilir.",
      action:
        "Biraz bekleyip yeniden dene. Sorun sürerse sağlayıcı hesabındaki kota ve bakiyeyi kontrol et veya bağlantının eşzamanlı istek sayısını azalt.",
    };
  if (status === 413)
    return {
      title: "Gönderilen içerik çok büyük",
      cause:
        "Mesaj, konuşma geçmişi veya ekler sunucunun istek boyutu sınırını aşıyor olabilir.",
      action:
        "Mesajı veya ekleri küçült. Gerekirse kişi ayarlarındaki bağlam bütçesini azalt ya da yeni bir grupta devam et.",
    };
  if ([400, 415, 422].includes(status))
    return {
      title: "Sunucu isteği kabul etmedi",
      cause:
        "Seçilen model, API biçimi veya gönderilen içeriğin türü bu istekle uyumlu olmayabilir. Hata kodu tek başına kesin nedeni belirtmez.",
      action:
        "Bağlantının adresini ve API biçimini, ardından kişinin modelini kontrol et. Ek varsa modelin bu medya türünü desteklediğinden emin ol.",
    };
  if (
    status === 408 ||
    status === 504 ||
    /Sunucuya ulaşılamadı|zaman aşımına uğradı/.test(clean)
  )
    return {
      title: "Sunucudan yanıt alınamadı",
      cause:
        "Sunucu kapalı olabilir, bağlantı kesilmiş olabilir veya yanıt zamanında gelmemiş olabilir.",
      action:
        "Yerel sunucu kullanıyorsan çalıştığını kontrol et. API adresini ve ağ bağlantısını doğrulayıp yeniden dene.",
    };
  if (status >= 500 && status <= 599)
    return {
      title: "Sağlayıcı tarafında bir sorun oluştu",
      cause:
        "Sunucu isteği işlerken hata verdi veya geçici olarak hizmet veremiyor.",
      action:
        "Biraz bekleyip yeniden dene. Devam ederse sağlayıcının hizmet durumunu kontrol et.",
    };
  if (/anahtar kasası|güvenli anahtar/i.test(clean))
    return {
      title: "Anahtar kasası açılamadı",
      cause:
        "İşletim sisteminin güvenli kasasına erişilemiyor. Anahtar düz metin olarak kaydedilmez.",
      action:
        "İşletim sistemindeki kasa erişim isteğini kontrol et. Kasa kullanılabilir olduğunda işlemi yeniden dene.",
    };
  if (/^Bağlam .+ sınırını aşıyor\./.test(clean))
    return {
      title: "Kişinin bağlam bütçesi aşıldı",
      cause:
        "Bu kişinin okuyacağı konuşma, ayarlanan karakter sınırından uzun. Geçmiş otomatik olarak kırpılmadı.",
      action:
        "Kişi ayarlarından bağlam bütçesini artır veya yeni bir grupta devam et. Modelin bağlam sınırını da dikkate al.",
    };
  if (
    /geçerli JSON döndürmedi|boş (veya desteklenmeyen )?bir yanıt döndürdü|mesaj\/alıcı biçimi geçersiz/.test(
      clean,
    )
  )
    return {
      title: "Modelin yanıtı işlenemedi",
      cause:
        "Sunucu boş bir yanıt veya uygulamanın beklediği biçime uymayan bir çıktı döndürdü.",
      action:
        "API biçimi ile modelin uyumunu kontrol et ve yeniden dene. Sorun sürerse başka bir sohbet modeli seç.",
    };
  if (/Bağlantı bulunamadı|model kimliği seç/.test(clean))
    return {
      title: "Kişinin model ayarları eksik",
      cause: "Bu kişiye ait bağlantı bulunamadı veya bir model seçilmedi.",
      action:
        "Kişi bilgilerini açıp kayıtlı bir API bağlantısı ve geçerli bir model seç.",
    };
  if (/^Animasyonlu WebP desteklenmiyor\./.test(clean))
    return {
      title: "Animasyonlu WebP desteklenmiyor",
      cause:
        "Bu uygulama WebP animasyonlarını henüz önizleyemiyor. Bu, dosyanın bozuk olduğu anlamına gelmez.",
      action: "Statik WebP, PNG veya GIF kopyasını ekle.",
    };
  if (/^Dosya boş\./.test(clean))
    return {
      title: "Dosya boş",
      cause: "Seçilen dosya 0 bayt; okunabilecek bir içeriği yok.",
      action:
        "İçerik bulunan geçerli bir kopya seç veya dosyayı yeniden kaydedip ekle.",
    };
  if (/100 MB|Görüntü boyutları çok büyük/.test(clean))
    return {
      title: "Dosya boyut sınırını aşıyor",
      cause:
        "Dosyanın boyutu veya görüntü çözünürlüğü güvenli işleme sınırının üzerinde.",
      action:
        "Dosyayı küçültüp yeniden ekle. Tek bir dosya en fazla 100 MB olabilir.",
    };
  return null;
}
