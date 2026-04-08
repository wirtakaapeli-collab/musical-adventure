<?php
/**
 * OLLIN HALLINTAPANEELI
 * - listaa PDF:t osioittain
 * - lataa uusia PDF:iä valittuun osioon
 * - poistaa PDF:iä
 * - tarjoaa JSON-listauksen osiosivuille (mode=list)
 */

declare(strict_types=1);

// Osioiden avaimet ja käyttöliittymän nimet.
$sections = [
    'tarinat' => 'Tarinat',
    'paivakirjat' => 'Päiväkirjat',
    'novellit' => 'Novellit',
    'paivan-ajatus' => 'Päivän ajatus',
];

// Turvallinen tiedostonimien tarkistus (vain osio-etuliite + .pdf).
function isAllowedPdfName(string $fileName, array $sections): bool
{
    if (!preg_match('/^[a-z0-9\-_.]+\.pdf$/i', $fileName)) {
        return false;
    }

    foreach (array_keys($sections) as $sectionKey) {
        if (str_starts_with(strtolower($fileName), strtolower($sectionKey) . '-')) {
            return true;
        }
    }

    return false;
}

// Hakee kaikki PDF:t, jotka alkavat osion avaimella (esim. tarinat-*.pdf).
function getSectionFiles(string $section, string $directory): array
{
    $pattern = $directory . DIRECTORY_SEPARATOR . $section . '-*.pdf';
    $files = glob($pattern) ?: [];

    $fileNames = array_map('basename', $files);
    natcasesort($fileNames);

    return array_values($fileNames);
}

// JSON-vastaus osiosivuille: /ollin-sivu.php?mode=list&section=tarinat
if (($_GET['mode'] ?? '') === 'list') {
    $section = $_GET['section'] ?? '';

    header('Content-Type: application/json; charset=utf-8');

    if (!array_key_exists($section, $sections)) {
        http_response_code(400);
        echo json_encode(['error' => 'Tuntematon osio']);
        exit;
    }

    $files = getSectionFiles($section, __DIR__);
    echo json_encode(['section' => $section, 'files' => $files], JSON_UNESCAPED_UNICODE);
    exit;
}

$message = '';
$error = '';

// Lomakkeiden käsittely (upload/delete)
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $action = $_POST['action'] ?? '';
    $section = $_POST['section'] ?? '';

    if (!array_key_exists($section, $sections)) {
        $error = 'Virheellinen osio valittu.';
    } else {
        // PDF:n poisto
        if ($action === 'delete') {
            $fileToDelete = basename($_POST['file_name'] ?? '');

            if (!isAllowedPdfName($fileToDelete, $sections)) {
                $error = 'Tiedoston poisto estettiin (virheellinen nimi).';
            } else {
                $targetPath = __DIR__ . DIRECTORY_SEPARATOR . $fileToDelete;
                if (is_file($targetPath) && unlink($targetPath)) {
                    $message = 'PDF poistettu: ' . htmlspecialchars($fileToDelete, ENT_QUOTES, 'UTF-8');
                } else {
                    $error = 'PDF:n poisto epäonnistui.';
                }
            }
        }

        // PDF:n lataus
        if ($action === 'upload') {
            if (!isset($_FILES['pdf_file']) || $_FILES['pdf_file']['error'] !== UPLOAD_ERR_OK) {
                $error = 'Lataus epäonnistui. Tarkista tiedosto.';
            } else {
                $tmpPath = $_FILES['pdf_file']['tmp_name'];
                $originalName = $_FILES['pdf_file']['name'];
                $extension = strtolower(pathinfo($originalName, PATHINFO_EXTENSION));

                if ($extension !== 'pdf') {
                    $error = 'Vain PDF-tiedostot ovat sallittuja.';
                } else {
                    // Siistitään tiedostonimi ja varmistetaan osio-etuliite.
                    $base = pathinfo($originalName, PATHINFO_FILENAME);
                    $safeBase = preg_replace('/[^a-zA-Z0-9\-_]+/', '-', $base);
                    $safeBase = trim((string)$safeBase, '-_');
                    if ($safeBase === '') {
                        $safeBase = 'tiedosto';
                    }

                    if (!str_starts_with(strtolower($safeBase), strtolower($section) . '-')) {
                        $safeBase = $section . '-' . $safeBase;
                    }

                    // Päivän ajatus: yksi tiedosto kerrallaan -> poistetaan vanhat ennen tallennusta.
                    if ($section === 'paivan-ajatus') {
                        $existing = getSectionFiles($section, __DIR__);
                        foreach ($existing as $oldFile) {
                            $oldPath = __DIR__ . DIRECTORY_SEPARATOR . $oldFile;
                            if (is_file($oldPath)) {
                                unlink($oldPath);
                            }
                        }
                    }

                    $targetName = $safeBase . '.pdf';
                    $targetPath = __DIR__ . DIRECTORY_SEPARATOR . $targetName;

                    // Jos sama nimi on jo käytössä, lisätään juokseva numero (ei päivän ajatukselle, joka korvataan).
                    if ($section !== 'paivan-ajatus') {
                        $counter = 1;
                        while (file_exists($targetPath)) {
                            $targetName = $safeBase . '-' . $counter . '.pdf';
                            $targetPath = __DIR__ . DIRECTORY_SEPARATOR . $targetName;
                            $counter++;
                        }
                    }

                    if (move_uploaded_file($tmpPath, $targetPath)) {
                        $message = 'PDF ladattu onnistuneesti: ' . htmlspecialchars($targetName, ENT_QUOTES, 'UTF-8');
                    } else {
                        $error = 'PDF:n tallennus epäonnistui palvelimella.';
                    }
                }
            }
        }
    }
}

// Kerätään näkymää varten aina ajantasainen osiolista.
$allFilesBySection = [];
foreach ($sections as $key => $title) {
    $allFilesBySection[$key] = getSectionFiles($key, __DIR__);
}
?>
<!DOCTYPE html>
<html lang="fi">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Admin-paneeli</title>
  <style>
    :root { --bg:#f3f6fb; --card:#fff; --text:#1f2a37; --muted:#52606d; --primary:#2b6cb0; --danger:#b42318; --border:#d8e2ef; --shadow:0 8px 22px rgba(15,23,42,.08); --radius:14px; }
    * { box-sizing:border-box; }
    body { margin:0; font-family:"Segoe UI",Roboto,Arial,sans-serif; color:var(--text); background:var(--bg); }
    .nav { background:#0f2942; box-shadow:0 3px 10px rgba(0,0,0,.2); }
    .nav-inner { max-width:1100px; margin:0 auto; padding:14px 20px; display:flex; flex-wrap:wrap; gap:10px; justify-content:space-between; }
    .brand { color:#fff; text-decoration:none; font-weight:700; }
    .nav-links { display:flex; flex-wrap:wrap; gap:10px; }
    .nav-links a { color:#fff; text-decoration:none; background:rgba(255,255,255,.14); padding:8px 12px; border-radius:999px; font-weight:600; }
    .container { max-width:1100px; margin:30px auto 60px; padding:0 20px; }
    .alert { padding:12px 14px; border-radius:10px; margin-bottom:15px; }
    .ok { background:#e7f8ed; border:1px solid #b8e6c8; color:#0f6b2f; }
    .err { background:#fdecec; border:1px solid #f6b9b9; color:#8f1d1d; }
    .grid { display:grid; gap:20px; grid-template-columns:repeat(auto-fit, minmax(240px, 1fr)); }
    .card { background:var(--card); border:1px solid var(--border); border-radius:var(--radius); box-shadow:var(--shadow); padding:18px; }
    h1 { margin-top:0; }
    h2 { margin-top:0; font-size:1.2rem; }
    .pdf-link { display:inline-block; color:#1f4f85; font-weight:700; text-decoration:none; background:#e5f0ff; border:1px solid #bdd8ff; padding:8px 10px; border-radius:9px; margin:0 8px 8px 0; }
    .form-row { display:grid; gap:10px; margin-top:10px; }
    label { font-weight:600; }
    select, input[type="file"], button { width:100%; padding:10px; border-radius:9px; border:1px solid var(--border); font:inherit; }
    button { cursor:pointer; font-weight:700; border:0; background:var(--primary); color:#fff; }
    button:hover { opacity:0.93; }
    .delete-btn { background:var(--danger); width:auto; padding:8px 11px; }
    .file-line { margin:8px 0; padding:8px; border:1px dashed #cfd9e6; border-radius:10px; display:flex; flex-wrap:wrap; gap:8px; align-items:center; justify-content:space-between; }
    .muted { color:var(--muted); font-style:italic; }
  </style>
</head>
<body>
  <nav class="nav" aria-label="Päänavigaatio">
    <div class="nav-inner">
      <a class="brand" href="index.html">Kirjallinen sivusto</a>
      <div class="nav-links">
        <a href="index.html">Etusivu</a>
        <a href="tarinat.html">Tarinat</a>
        <a href="paivakirjat.html">Päiväkirjat</a>
        <a href="novellit.html">Novellit</a>
        <a href="paivan-ajatus.html">Päivän ajatus</a>
        <a href="ollin-sivu.php">Admin</a>
      </div>
    </div>
  </nav>

  <main class="container">
    <h1>Admin-paneeli</h1>
    <p>Hallinnoi PDF-tiedostoja osioittain. Kaikki tiedostot tallennetaan tähän samaan kansioon.</p>

    <?php if ($message !== ''): ?>
      <div class="alert ok"><?= $message ?></div>
    <?php endif; ?>

    <?php if ($error !== ''): ?>
      <div class="alert err"><?= htmlspecialchars($error, ENT_QUOTES, 'UTF-8') ?></div>
    <?php endif; ?>

    <section class="card" style="margin-bottom:20px;">
      <h2>Lataa uusi PDF</h2>
      <!-- Upload-lomake: lähettää tiedoston valittuun osioon -->
      <form method="post" enctype="multipart/form-data">
        <input type="hidden" name="action" value="upload">
        <div class="form-row">
          <label for="section">Valitse osio</label>
          <select name="section" id="section" required>
            <?php foreach ($sections as $key => $title): ?>
              <option value="<?= htmlspecialchars($key, ENT_QUOTES, 'UTF-8') ?>"><?= htmlspecialchars($title, ENT_QUOTES, 'UTF-8') ?></option>
            <?php endforeach; ?>
          </select>

          <label for="pdf_file">Valitse PDF-tiedosto</label>
          <input type="file" id="pdf_file" name="pdf_file" accept="application/pdf,.pdf" required>

          <button type="submit">Lataa PDF</button>
        </div>
      </form>
    </section>

    <div class="grid">
      <?php foreach ($sections as $key => $title): ?>
        <section class="card">
          <h2><?= htmlspecialchars($title, ENT_QUOTES, 'UTF-8') ?></h2>

          <?php if (count($allFilesBySection[$key]) === 0): ?>
            <p class="muted">Ei PDF-tiedostoja tässä osiossa.</p>
          <?php else: ?>
            <?php foreach ($allFilesBySection[$key] as $fileName): ?>
              <div class="file-line">
                <a class="pdf-link" href="<?= rawurlencode($fileName) ?>" target="_blank" rel="noopener"><?= htmlspecialchars($fileName, ENT_QUOTES, 'UTF-8') ?></a>

                <!-- Poisto-lomake yhdelle tiedostolle -->
                <form method="post" style="margin:0;">
                  <input type="hidden" name="action" value="delete">
                  <input type="hidden" name="section" value="<?= htmlspecialchars($key, ENT_QUOTES, 'UTF-8') ?>">
                  <input type="hidden" name="file_name" value="<?= htmlspecialchars($fileName, ENT_QUOTES, 'UTF-8') ?>">
                  <button type="submit" class="delete-btn" onclick="return confirm('Poistetaanko tiedosto varmasti?');">Poista</button>
                </form>
              </div>
            <?php endforeach; ?>
          <?php endif; ?>
        </section>
      <?php endforeach; ?>
    </div>
  </main>
</body>
</html>
