<p align="center">
  <img src="app/assets/NHIS%20Checker.svg" width="112" alt="NHIS Checker" />
</p>
<h1 align="center">NHIS Checker</h1>
<p align="center"><strong>Дентален статус и лечения от НЗИС — в едно настолно приложение.</strong><br />Разработено от AIDOO за macOS и Windows.</p>
<p align="center">
  <a href="https://github.com/aidoo-dental/nhis-checker/releases/latest"><img alt="Последна версия" src="https://img.shields.io/github/v/release/aidoo-dental/nhis-checker?label=version&amp;color=087f6b" /></a>
  <a href="https://github.com/aidoo-dental/nhis-checker/actions/workflows/windows.yml"><img alt="Windows build" src="https://github.com/aidoo-dental/nhis-checker/actions/workflows/windows.yml/badge.svg" /></a>
  <a href="LICENSE"><img alt="GPL v3" src="https://img.shields.io/badge/license-GPL--3.0-blue" /></a>
</p>
<p align="center">
  <a href="#изтегляне">Изтегляне</a> · <a href="#първо-стартиране">Първо стартиране</a> · <a href="#карта-на-файловете">Карта на файловете</a> · <a href="docs/BUILDING.md">Компилиране</a> · <a href="https://github.com/aidoo-dental/nhis-checker/issues">Обратна връзка</a>
</p>

## Изтегляне

**Версия 1.0.12** включва фиксирани заглавия на колоните при скролиране, проверка на имената на пациента и подписани инсталатори.

| Файл | За кой компютър е | Какво прави |
| :--- | :--- | :--- |
| [NHIS Checker 1.0.12 — Apple Silicon.dmg](https://github.com/aidoo-dental/nhis-checker/releases/download/v1.0.12/NHIS.Checker.1.0.12.-.Apple.Silicon.dmg) | Mac с Apple Silicon, macOS 12.0+ | Отваря диск с приложението. Премести **NHIS Checker** в **Applications**. |
| [NHIS Checker 1.0.12 — Intel.dmg](https://github.com/aidoo-dental/nhis-checker/releases/download/v1.0.12/NHIS.Checker.1.0.12.-.Intel.dmg) | Mac с Intel, macOS 12.0+ | Същото приложение, компилирано за Intel. Премести го в **Applications**. |
| [NHIS Checker 1.0.12 — Windows x64 Setup.exe](https://github.com/aidoo-dental/nhis-checker/releases/download/v1.0.12/NHIS.Checker.1.0.12.-.Windows.x64.Setup.exe) | Windows 10 1809+ или Windows 11, x64 | Инсталира приложението за текущия потребител, нужните библиотеки и пряк път в Start менюто. |

На Mac провери процесора от ** → About This Mac / За този Mac**. Драйверът за КЕП трябва да съответства на архитектурата на приложението; за Windows е нужен 64-битов драйвер от доставчика.

**Подписване:** Mac приложението и DMG файловете са подписани с Developer ID на **Aidoo Ltd. OOD** и нотариализирани от Apple. Windows приложението, инсталаторът и деинсталаторът се подписват чрез **Azure Artifact Signing**, с издател **Aidoo LTD** и времеви печат.

[Всички версии и бележки към изданията →](https://github.com/aidoo-dental/nhis-checker/releases)

Файловете **Source code (zip)** и **Source code (tar.gz)** в GitHub съдържат програмния код. За инсталиране избери съответния **DMG** или **Setup.exe** от таблицата.

## Какво можеш да правиш

- **Дентален статус:** преглед на зъбната схема и състоянието по дати.
- **Лечения:** дейности, диагнози, засегнати зъби, изпълнител и НРН, подредени от най-новите към по-старите.
- **Удобен преглед:** филтри по дата, зъб и лечение, подробности за дейността и видими заглавия на колоните при скролиране.
- **Приключено и анулирано:** обозначаване с икони; краят на лечението се отчита от върнатите данни.
- **Оригинален XML:** запазване на отговора от успешно проверената справка.
- **Настройки и диагностика:** страничен панел, кратки известия и журнал с последните 100 грешки, който може да се копира и изчиства.

Приложението извършва справки. Създаването, приключването и анулирането на лечения се извършват в софтуера, с който ги подаваш към НЗИС.

## Първо стартиране

1. Инсталирай приложението и драйвера за КЕП на твоя доставчик.
2. Отвори **Настройки**, въведи **9-цифрения дентален ЛПК** и **РЗИ номера на практиката**, избери среда и запази. При първо стартиране е избрана тестовата среда.
3. Включи КЕП и натисни **Провери КЕП**. При нужда посочи PKCS#11 драйвера в настройките.
4. Въведи **име, фамилия, тип идентификатор и идентификатор**. Презимето е по желание. Избери **Изтегли статус** или **Изтегли лечение**.

При включено запомняне КЕП сесията остава отключена до два часа. ПИН кодът не се записва на диск. **Заключи КЕП** прекратява сесията веднага.

### Как се проверява пациентът

Преди показване и XML експорт приложението сравнява идентификатора, неговия тип, името и фамилията с пациентските данни във **всеки върнат D006 запис**. Попълненото презиме също се проверява. Главни/малки букви и излишни интервали се игнорират; съкратени имена, правописни грешки и транслитерация не се приемат.

При несъответствие или липса на данни за потвърждение справката се блокира. Отговорът D010 за статус няма имена, затова преди него се прави D005/D006 проверка. Това е съпоставка с върнатите дентални записи, **не е отделна справка в ГРАО**. Ако няма записи с пациентски данни, и статусът остава блокиран.

Заявките се изпращат директно към избраната среда на НЗИС. „Статус по дати“ показва последното известно състояние според върнатите дейности; за зъб без запис се показва „Няма данни“.

## Карта на файловете

Проектът използва **C++20 и Qt 6** за приложението и **HTML/CSS/JavaScript** за вградения интерфейс. На macOS интерфейсът се показва с WKWebView, а на Windows — с Qt WebEngine. Файловете `.h` описват интерфейсите към съответните C++ модули.

### Приложение и връзка с НЗИС

| Файл | Отговорност |
| :--- | :--- |
| [CMakeLists.txt](CMakeLists.txt) | Версия, зависимости, ресурси, компилиране и тестови цели. |
| [app/main.cpp](app/main.cpp) | Стартира приложението и създава основния прозорец. |
| [app/desktop.cpp](app/desktop.cpp) | Изпълнява командите от интерфейса: настройки, справки, XML експорт, журнал и файлови диалози. |
| [app/nhis.cpp](app/nhis.cpp) | HTTPS заявки, автентикация, токен, КЕП сесия и проверка на пациента преди връщане на резултат. |
| [app/protocol.cpp](app/protocol.cpp) | Създава D005/D009 XML; валидира входа, отговорите и пациентските данни; извлича грешките на НЗИС. |
| [app/signing.cpp](app/signing.cpp) | Работа с PKCS#11 драйвера и токена: отключване, сертификат и подписване. |
| [app/xml_signature.cpp](app/xml_signature.cpp) | XMLDSig/XAdES подпис: канонизация, хешове и структура на подписания XML. |
| [app/certificate.cpp](app/certificate.cpp) | Извлича полета и DER представяне на X.509 сертификата. |
| [app/error.h](app/error.h) | Общ помощен механизъм за предаване на грешка към горните слоеве. |
| [app/ui.cpp](app/ui.cpp) | Сглобява HTML, стилове, скриптове, номенклатури и SVG ресурси във вградения интерфейс. |
| [app/browser.h](app/browser.h) | Общ интерфейс между нативното приложение и вградения браузър. |
| [app/browser_mac.mm](app/browser_mac.mm) | WKWebView, връзка JavaScript ↔ C++ и macOS команди за редактиране. |
| [app/browser_qt.cpp](app/browser_qt.cpp) | Qt WebEngine и QWebChannel за връзка с интерфейса под Windows. |
| [app/windows.rc.in](app/windows.rc.in) | Икона и версия в Windows EXE файла. |

### Интерфейс и изображения

| Файл / папка | Отговорност |
| :--- | :--- |
| [app/ui/index.html](app/ui/index.html) | Формата за пациент, табовете, таблицата и панелът с настройки. |
| [app/ui/styles.css](app/ui/styles.css) | Външен вид, размери, скролиране, фиксирани заглавия и адаптация към прозореца. |
| [app/ui/layout.js](app/ui/layout.js) | Смяна на табовете, навигация и общо форматиране на полета и дати. |
| [app/ui/bridge.js](app/ui/bridge.js) | Изпраща команди от JavaScript към нативното приложение и обработва отговорите. |
| [app/ui/lookups.js](app/ui/lookups.js) | Стартира справките, управлява зареждането и XML експорта. |
| [app/ui/xml-response.js](app/ui/xml-response.js) | Преобразува XML отговорите в данни за интерфейса. |
| [app/ui/treatments.js](app/ui/treatments.js) | Сортиране, филтриране и показване на лечения, зъби и подробности за дейностите. |
| [app/ui/odontogram.js](app/ui/odontogram.js) | Зъбна схема, състояния и преглед по дати. |
| [app/ui/settings.js](app/ui/settings.js) | Настройки, избор на драйвер, проверка и заключване на КЕП. |
| [app/ui/notifications.js](app/ui/notifications.js) | Toast известия, показване, копиране и изчистване на журнала. |
| [app/ui/nomenclatures.json](app/ui/nomenclatures.json) | Локални етикети за кодовете, използвани при показване на данните. |
| [app/ui/teeth/](app/ui/teeth/) · [app/ui/status/](app/ui/status/) | SVG изображения на зъбите и иконите за състояние. |
| [app/assets/](app/assets/) | SVG икона на приложението, `.icns` за macOS, `.ico` за Windows и лицензи на включените библиотеки. |

### Пакетиране, подписване и тестове

| Файл | Отговорност |
| :--- | :--- |
| [scripts/package-macos.sh](scripts/package-macos.sh) | Събира macOS приложението и библиотеките, проверява архитектурата и минималната система и създава DMG. |
| [scripts/notarize-macos.py](scripts/notarize-macos.py) | Developer ID подписване, Apple нотариализация, прикрепване на билети и проверка с Gatekeeper. |
| [scripts/package-windows.ps1](scripts/package-windows.ps1) | Събира EXE и DLL зависимостите и стартира създаването на Windows инсталатора. |
| [scripts/windows-installer.iss](scripts/windows-installer.iss) | Inno Setup конфигурация: инсталационна папка, преки пътища, деинсталатор и поддръжка за подписване. |
| [scripts/prepare-azure-tools.ps1](scripts/prepare-azure-tools.ps1) | Подготвя и проверява Microsoft SignTool и клиента за Azure Artifact Signing. |
| [scripts/sign-windows-azure.ps1](scripts/sign-windows-azure.ps1) | Подписва конкретен Windows файл и проверява издателя и времевия печат. |
| [scripts/azure-signing-metadata.json](scripts/azure-signing-metadata.json) | Адрес и профил на услугата за подписване; не съдържа парола или частен ключ. |
| [scripts/azure-pipelines-signing.yml](scripts/azure-pipelines-signing.yml) | Azure процес за проверка на готовия пакет, подписване и тест на инсталираното приложение. |
| [.github/workflows/windows.yml](.github/workflows/windows.yml) | GitHub Actions билд за Windows, тестове, инсталатор и артефакт за последващо подписване. |
| [tests/protocol_signature.cpp](tests/protocol_signature.cpp) | Тестове за XML протокола, цифровия подпис, грешките и съвпадението на пациента със синтетични данни. |
| [tests/ui_resources.cpp](tests/ui_resources.cpp) | Проверява, че всички нужни ресурси на интерфейса са включени в приложението. |
| [tests/windows-smoke.cjs](tests/windows-smoke.cjs) | Стартира инсталирания Windows EXE и проверява интерфейса, нативната връзка, журнала и заглавията при скрол. |

`build-*`, `dist/` и `.deps/` са локални папки за компилиране, готови пакети и зависимости; не са част от изходния код в Git. Готовите инсталатори са в **Releases**.

## За разработчици

- [Компилиране за macOS и Windows](docs/BUILDING.md)
- [Подписване и публикуване на издание](docs/RELEASING.md)
- [История на промените](CHANGELOG.md)

Автоматичните проверки използват тестови данни и не извършват жива справка с пациентски КЕП. Тест на действителен токен, неговия драйвер и продукционния достъп е отделна проверка.

## Лиценз и източници

Кодът е под [GNU GPL v3](LICENSE). **Кодът за XML подписване с КЕП е взет от [DinoDent](https://github.com/thefinalcutbg/DinoDent) на [thefinalcutbg](https://github.com/thefinalcutbg) и е адаптиран за NHIS Checker.** Денталните SVG изображения и иконите за статус са от AIDOO. Лицензите на включените библиотеки са в [app/assets/licenses](app/assets/licenses) и в инсталационните пакети.

Използвани са [спецификацията за денталните услуги](https://docs.google.com/spreadsheets/d/1SOLwRGWEb0McPhBME2lbi2OVRpkRwQlfN_4cMv7Y5vk/edit) и [номенклатурите на НЗИС](https://docs.google.com/spreadsheets/d/11V7vP_dcqIPoLfbM69vSGtW8YvyjtxETXOiOWkFoy_Q/edit).
