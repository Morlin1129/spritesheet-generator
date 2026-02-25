#target photoshop
app.bringToFront();

(function () {
  if (!app.documents.length) {
    alert("ドキュメントが開かれていません");
    return;
  }

  var doc = app.activeDocument;

  // ========= ユーティリティ =========
  function isBackground(layer) {
    try { return layer.isBackgroundLayer; } catch (e) { return false; }
  }

  function hideAll(container) {
    for (var i = 0; i < container.layers.length; i++) {
      var l = container.layers[i];
      try { l.visible = false; } catch (e) {}
      if (l.typename === "LayerSet") hideAll(l);
    }
  }

  function getTopLevelSets(d) {
    var sets = [];
    for (var i = 0; i < d.layerSets.length; i++) sets.push(d.layerSets[i]);
    return sets;
  }

  function getTopLevelLayers(d) {
    // doc.layers: 直下の ArtLayer / LayerSet を含む
    var arr = [];
    for (var i = 0; i < d.layers.length; i++) arr.push(d.layers[i]);
    return arr;
  }

  function getChildrenAsFrames(layerSet) {
    // グループ直下の要素をフレーム扱い
    var arr = [];
    for (var i = 0; i < layerSet.layers.length; i++) arr.push(layerSet.layers[i]);
    return arr;
  }

  function sortByNameNumericSafe(items) {
    // "000", "001", "walk_002" みたいなのをざっくり安定させる用
    // 数字を含む場合は数字優先、それ以外は文字列
    function extractNum(s) {
      var m = String(s).match(/(\d+)/);
      return m ? parseInt(m[1], 10) : null;
    }
    items.sort(function (a, b) {
      var an = extractNum(a.name);
      var bn = extractNum(b.name);
      if (an !== null && bn !== null && an !== bn) return an - bn;
      var as = String(a.name).toLowerCase();
      var bs = String(b.name).toLowerCase();
      if (as < bs) return -1;
      if (as > bs) return 1;
      return 0;
    });
    return items;
  }

  function ensureFolder(path) {
    var f = new Folder(path);
    if (!f.exists) f.create();
    return f;
  }

  // PNG書き出し（Save for Web）
  function exportPng(docToExport, outFile) {
    var opt = new ExportOptionsSaveForWeb();
    opt.format = SaveDocumentType.PNG;
    opt.PNG8 = false;
    opt.transparency = true;
    opt.interlaced = false;
    opt.quality = 100;
    docToExport.exportDocument(outFile, ExportType.SAVEFORWEB, opt);
  }

  function writeJson(outFile, obj) {
    outFile.encoding = "UTF8";
    outFile.open("w");
    outFile.write(JSON.stringify(obj, null, 2));
    outFile.close();
  }

  // ========= 1フレームを一時PNG化 =========
  function renderFrameToTempPng(frameLayer, tempFile, cellW, cellH) {
    // 対象フレームだけ表示
    frameLayer.visible = true;

    // ドキュメント複製
    var tmp = doc.duplicate("tmp_export", false);

    // 表示レイヤーを統合（見えてるものだけ残す）
    tmp.mergeVisibleLayers();

    // セルサイズに合わせてキャンバス調整（中心）
    tmp.resizeCanvas(UnitValue(cellW, "px"), UnitValue(cellH, "px"), AnchorPosition.MIDDLECENTER);

    // 書き出し
    exportPng(tmp, tempFile);

    tmp.close(SaveOptions.DONOTSAVECHANGES);

    // 元に戻す
    frameLayer.visible = false;
  }

  // ========= シート作成＆貼り付け =========
  function placePngToSheet(sheetDoc, file, x, y) {
    app.activeDocument = sheetDoc;

    var d = app.open(file);
    d.selection.selectAll();
    d.selection.copy();
    d.close(SaveOptions.DONOTSAVECHANGES);

    sheetDoc.paste();
    var pasted = sheetDoc.activeLayer;
    pasted.translate(x, y);
  }

  function buildSpriteSheet(frames, options, outFolder, baseName) {
    // frames: [{ anim, layer, name }]
    if (!frames || frames.length === 0) return;

    // 念のため全非表示
    hideAll(doc);

    // 一時フレーム書き出し
    var tempFolder = ensureFolder(outFolder.fsName + "/_tmp_frames");
    var tempFiles = [];

    for (var i = 0; i < frames.length; i++) {
      var tf = new File(tempFolder.fsName + "/" + frames[i].name + ".png");
      renderFrameToTempPng(frames[i].layer, tf, options.cellW, options.cellH);
      tempFiles.push(tf);
    }

    var total = tempFiles.length;
    var cols = options.columns;
    if (cols < 1) cols = 1;

    var rows = Math.ceil(total / cols);
    var sheetW = options.cellW * cols;
    var sheetH = options.cellH * rows;

    // シート新規
    var sheet = app.documents.add(
      sheetW,
      sheetH,
      doc.resolution,
      baseName,
      NewDocumentMode.RGB,
      DocumentFill.TRANSPARENT
    );

    // メタ
    var meta = {
      image: baseName + ".png",
      cell: { w: options.cellW, h: options.cellH },
      columns: cols,
      frames: []
    };

    // 貼り付け＆メタ生成
    for (var k = 0; k < total; k++) {
      var x = (k % cols) * options.cellW;
      var y = Math.floor(k / cols) * options.cellH;

      placePngToSheet(sheet, tempFiles[k], x, y);

      meta.frames.push({
        name: frames[k].name,
        anim: frames[k].anim,
        frame: { x: x, y: y, w: options.cellW, h: options.cellH }
      });
    }

    // 書き出し
    var outPng = new File(outFolder.fsName + "/" + baseName + ".png");
    exportPng(sheet, outPng);

    var outJson = new File(outFolder.fsName + "/" + baseName + ".json");
    writeJson(outJson, meta);

    // シート閉じる（好みで）
    sheet.close(SaveOptions.DONOTSAVECHANGES);
  }

  // ========= UI (ScriptUI) =========
  function showDialog(defaults) {
    var w = new Window("dialog", "Export Sprite Sheet");
    w.orientation = "column";
    w.alignChildren = ["fill", "top"];

    // モード
    var pnlMode = w.add("panel", undefined, "Mode");
    pnlMode.orientation = "column";
    pnlMode.alignChildren = ["left", "top"];

    var rbGroup = pnlMode.add("radiobutton", undefined, "グループごとに生成（最上位グループ単位）");
    var rbOne = pnlMode.add("radiobutton", undefined, "すべてまとめて1枚に生成（ドキュメント直下）");

    rbGroup.value = defaults.mode === "byGroup";
    rbOne.value = defaults.mode === "single";

    // オプション
    var pnlOpt = w.add("panel", undefined, "Options");
    pnlOpt.orientation = "column";
    pnlOpt.alignChildren = ["fill", "top"];

    function addRow(label, defVal) {
      var g = pnlOpt.add("group");
      g.orientation = "row";
      g.alignChildren = ["left", "center"];
      g.add("statictext", undefined, label);
      var et = g.add("edittext", undefined, String(defVal));
      et.characters = 8;
      return et;
    }

    var etCellW = addRow("Cell Width(px):", defaults.cellW);
    var etCellH = addRow("Cell Height(px):", defaults.cellH);
    var etCols = addRow("Columns:", defaults.columns);

    var gName = pnlOpt.add("group");
    gName.orientation = "row";
    gName.alignChildren = ["left", "center"];
    gName.add("statictext", undefined, "Base Name:");
    var etBase = gName.add("edittext", undefined, defaults.baseName);
    etBase.characters = 18;

    // ソート/除外
    var pnlAdv = w.add("panel", undefined, "Advanced");
    pnlAdv.orientation = "column";
    pnlAdv.alignChildren = ["left", "top"];

    var cbSort = pnlAdv.add("checkbox", undefined, "名前でソート（数字優先）");
    cbSort.value = defaults.sortByName;

    var cbSkipHidden = pnlAdv.add("checkbox", undefined, "最初から非表示のレイヤーは除外");
    cbSkipHidden.value = defaults.skipHidden;

    var cbSkipName = pnlAdv.add("checkbox", undefined, "名前に #skip を含むものは除外");
    cbSkipName.value = defaults.skipByName;

    // ボタン
    var btns = w.add("group");
    btns.alignment = "right";
    var ok = btns.add("button", undefined, "Export", { name: "ok" });
    var cancel = btns.add("button", undefined, "Cancel", { name: "cancel" });

    ok.onClick = function () {
      function toInt(s, fallback) {
        var n = parseInt(String(s), 10);
        return isNaN(n) ? fallback : n;
      }

      w.close(1);

      var mode = rbGroup.value ? "byGroup" : "single";
      var result = {
        mode: mode,
        cellW: toInt(etCellW.text, defaults.cellW),
        cellH: toInt(etCellH.text, defaults.cellH),
        columns: toInt(etCols.text, defaults.columns),
        baseName: etBase.text || defaults.baseName,
        sortByName: cbSort.value,
        skipHidden: cbSkipHidden.value,
        skipByName: cbSkipName.value
      };

      // 最低値ガード
      if (result.cellW < 1) result.cellW = defaults.cellW;
      if (result.cellH < 1) result.cellH = defaults.cellH;
      if (result.columns < 1) result.columns = defaults.columns;

      w.result = result;
    };

    cancel.onClick = function () {
      w.close(0);
    };

    var r = w.show();
    if (r !== 1) return null;
    return w.result;
  }

  // ========= フレーム収集 =========
  function filterFrames(items, opts) {
    var out = [];
    for (var i = 0; i < items.length; i++) {
      var l = items[i];
      if (isBackground(l)) continue;
      if (opts.skipByName && String(l.name).indexOf("#skip") !== -1) continue;
      if (opts.skipHidden && l.visible === false) continue;
      out.push(l);
    }
    if (opts.sortByName) out = sortByNameNumericSafe(out);
    return out;
  }

  function buildFramesSingle(opts) {
    // doc直下を全部フレーム（レイヤー/グループ混在OK）
    var root = filterFrames(getTopLevelLayers(doc), opts);
    var frames = [];
    for (var i = 0; i < root.length; i++) {
      frames.push({
        anim: "default",
        layer: root[i],
        name: root[i].name
      });
    }
    return frames;
  }

  function buildFramesByGroup(opts) {
    // 最上位グループ単位で別シート
    var sets = getTopLevelSets(doc);
    return sets; // ここではグループ配列を返して、あとで個別に処理
  }

  // ========= メイン =========
  var defaults = {
    mode: "byGroup",     // "byGroup" or "single"
    cellW: 128,
    cellH: 128,
    columns: 8,
    baseName: "spritesheet",
    sortByName: true,
    skipHidden: false,
    skipByName: true
  };

  var opts = showDialog(defaults);
  if (!opts) return;

  var outFolder = Folder.selectDialog("出力先フォルダを選択");
  if (!outFolder) return;

  // 実行前に全非表示 → 以後は各フレームだけ点灯して複製する方式
  hideAll(doc);

  if (opts.mode === "single") {
    var frames = buildFramesSingle(opts);
    if (!frames.length) {
      alert("フレームが見つかりませんでした（除外条件も確認してください）。");
      return;
    }
    buildSpriteSheet(frames, opts, outFolder, opts.baseName);
    alert("完了: " + opts.baseName + ".png / .json");
    return;
  }

  // byGroup
  var groups = buildFramesByGroup(opts);
  if (!groups.length) {
    // グループが無いなら single にフォールバック
    var frames2 = buildFramesSingle(opts);
    if (!frames2.length) {
      alert("最上位グループも直下レイヤーも見つかりませんでした。");
      return;
    }
    buildSpriteSheet(frames2, opts, outFolder, opts.baseName);
    alert("グループが無かったため、まとめて1枚で出力しました: " + opts.baseName + ".png / .json");
    return;
  }

  // グループごとに出力
  for (var g = 0; g < groups.length; g++) {
    var set = groups[g];
    if (opts.skipByName && String(set.name).indexOf("#skip") !== -1) continue;
    if (opts.skipHidden && set.visible === false) continue;

    var children = filterFrames(getChildrenAsFrames(set), opts);
    if (!children.length) continue;

    var framesG = [];
    for (var i3 = 0; i3 < children.length; i3++) {
      framesG.push({
        anim: set.name,
        layer: children[i3],
        name: set.name + "_" + children[i3].name
      });
    }

    // ファイル名は baseName + "_" + groupName
    var safeGroupName = String(set.name).replace(/[\\\/\:\*\?\"\<\>\|]/g, "_");
    var outName = opts.baseName + "_" + safeGroupName;

    buildSpriteSheet(framesG, opts, outFolder, outName);
  }

  alert("完了: グループごとにPNG/JSONを出力しました。");

})();
