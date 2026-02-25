#target photoshop

function main() {
    if (app.documents.length === 0) return;
    
    var doc = app.activeDocument;
    var originalUnit = app.preferences.rulerUnits;
    app.preferences.rulerUnits = Units.PIXELS;
    
    var docW = doc.width.value;
    var docH = doc.height.value;

    var dlg = new Window("dialog", "スプライトシート作成 (位置維持版)");
    dlg.orientation = "column";
    dlg.alignChildren = "fill";

    var modePnl = dlg.add("panel", undefined, "出力モード");
    var rbSingle = modePnl.add("radiobutton", undefined, "全レイヤーを1枚に");
    var rbGroup = modePnl.add("radiobutton", undefined, "グループごとに出力");
    rbSingle.value = true;
    
    var sizePnl = dlg.add("panel", undefined, "各セルのサイズ (px)");
    sizePnl.add("statictext", undefined, "幅:");
    var cellW = sizePnl.add("edittext", undefined, docW);
    cellW.characters = 5;
    sizePnl.add("statictext", undefined, "高さ:");
    var cellH = sizePnl.add("edittext", undefined, docH);
    cellH.characters = 5;

    var colPnl = dlg.add("panel", undefined, "配置設定");
    colPnl.add("statictext", undefined, "カラム数:");
    var columns = colPnl.add("edittext", undefined, "5");
    columns.characters = 5;

    var btnGroup = dlg.add("group");
    btnGroup.alignment = "center";
    btnGroup.add("button", undefined, "キャンセル", {name: "cancel"});
    btnGroup.add("button", undefined, "実行", {name: "ok"});

    if (dlg.show() == 1) {
        var config = {
            width: parseInt(cellW.text),
            height: parseInt(cellH.text),
            cols: parseInt(columns.text)
        };
        
        if (rbGroup.value) {
            for (var i = 0; i < doc.layerSets.length; i++) {
                processTarget(doc, doc.layerSets[i].layers, config, doc.layerSets[i].name);
            }
        } else {
            processTarget(doc, doc.layers, config, "SpriteSheet_Output");
        }
    }
    app.preferences.rulerUnits = originalUnit;
}

function processTarget(sourceDoc, layerSource, config, fileName) {
    var targetLayers = [];
    // レイヤー順（重なり順）を維持
    for (var i = 0; i < layerSource.length; i++) {
        if (!layerSource[i].isBackgroundLayer) {
            targetLayers.push(layerSource[i]);
        }
    }
    if (targetLayers.length === 0) return;
    createSpriteSheet(sourceDoc, targetLayers, config, fileName);
}

function createSpriteSheet(sourceDoc, layers, config, fileName) {
    var numLayers = layers.length;
    var rows = Math.ceil(numLayers / config.cols);
    
    var spriteDoc = app.documents.add(
        config.width * config.cols, 
        config.height * rows, 
        sourceDoc.resolution, 
        fileName, 
        NewDocumentMode.RGB, 
        DocumentFill.TRANSPARENT
    );

    // Photoshopの重なり順（上から下）に合わせてループ
    for (var i = 0; i < numLayers; i++) {
        app.activeDocument = sourceDoc;
        var currentLayer = layers[i]; 
        
        // 元のレイヤーの左上の位置を取得（これが重要！）
        var curX = currentLayer.bounds[0].value;
        var curY = currentLayer.bounds[1].value;

        // レイヤーを複製
        var duplicatedLayer = currentLayer.duplicate(spriteDoc, ElementPlacement.PLACEATBEGINNING);
        
        app.activeDocument = spriteDoc;
        duplicatedLayer.visible = true; 
        
        // カラム位置の計算
        var col = i % config.cols;
        var row = Math.floor(i / config.cols);
        
        // 配置計算：
        // 1. まず(0,0)地点に移動させる： -duplicatedLayer.bounds[0]
        // 2. セルの開始座標を加算： + (col * config.width)
        // 3. 元のドキュメント内での相対位置(curX)を加算： + curX
        // ※ ただし、duplicateすると座標が維持される場合があるため、
        // 「セルの左上 + 元の座標 - 現在の座標」で差分移動させます。
        
        var targetX = (col * config.width) + curX;
        var targetY = (row * config.height) + curY;
        
        var moveX = targetX - duplicatedLayer.bounds[0].value;
        var moveY = targetY - duplicatedLayer.bounds[1].value;
        
        duplicatedLayer.translate(moveX, moveY);
    }
}

main();
