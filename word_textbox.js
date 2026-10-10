// Word-style shape insertion and attached text editing (Fabric 5).
(() => {
    // Fabric control coordinates run from -0.5 to +0.5. The previous y=1
    // placed the handle beyond the tail and assumed a fixed 50px height.
    moveTailAction = (eventData, transform, x, y) => {
        const tail = transform.target, main = tail.parentBubble;
        if (!main) return false;
        const center = main.getCenterPoint();
        const dx = x - center.x, dy = y - center.y;
        const angle = Math.atan2(dy, dx), distance = Math.hypot(dx, dy);
        const localAngle = angle - fabric.util.degreesToRadians(main.angle);
        const w = main.getScaledWidth()/2, h = main.getScaledHeight()/2;
        const edge = (w*h)/Math.hypot(h*Math.cos(localAngle), w*Math.sin(localAngle));
        const rootDistance = Math.max(0, Math.min(edge + (tail.isThoughtTail ? 20 : -15), distance - 1));
        tail.controls.tipControl.y = 0.5;
        tail.set({ left: center.x + Math.cos(angle)*rootDistance,
            top: center.y + Math.sin(angle)*rootDistance,
            angle: fabric.util.radiansToDegrees(angle)-90,
            scaleY: Math.max(0.001, (distance-rootDistance)/(tail.height+tail.strokeWidth)) });
        if (tail.isThoughtTail) {
            tail.getObjects().forEach(circle => circle.set('scaleY', 1/tail.scaleY));
            tail.dirty = true;
        }
        tail.setCoords();
        // Correct from the rendered control position, including Fabric's stroke
        // bounds and origin offsets, rather than a nominal path length.
        const handle = tail.oCoords.tipControl;
        const pointer = fabric.util.transformPoint(new fabric.Point(x,y), canvas.viewportTransform);
        const inverse = fabric.util.invertTransform(canvas.viewportTransform);
        const adjustment = fabric.util.transformPoint(new fabric.Point(pointer.x-handle.x,
            pointer.y-handle.y), [inverse[0],inverse[1],inverse[2],inverse[3],0,0]);
        tail.set({left: tail.left+adjustment.x, top: tail.top+adjustment.y});
        tail.setCoords(); canvas.requestRenderAll();
        return true;
    };
    const english = document.documentElement.lang.startsWith('en');
    const button = document.getElementById('addBubbleBtn');
    let inserting = false, start = null, preview = null, pendingEdit = null;
    canvas.selection = false;
    canvas.uniformScaling = false;
    const message = english
        ? 'Click for a default box, or drag to draw. Click inside to type; drag the border to move. Esc cancels.'
        : '單擊建立預設尺寸，或拖曳繪製。點擊框內輸入文字，拖曳邊框移動。Esc 取消。';
    button.textContent = english ? '+ Insert text box' : '+ 插入文字框';
    button.nextElementSibling.textContent = message;

    function layoutText(main) {
        const text = main.linkedText;
        if (!text) return;
        const width = main.getScaledWidth(), height = main.getScaledHeight();
        const inset = main.bubbleType === 'explosion' ? 0.6 :
            ['ellipse', 'thought'].includes(main.bubbleType) ? 0.68 : 0.86;
        text.set({ width: Math.max(20, width * inset), scaleX: 1, scaleY: 1,
            angle: main.angle, left: main.getCenterPoint().x, top: main.getCenterPoint().y });
        text.initDimensions();
        // Grow the frame to keep typed text inside; resizing never changes the font size.
        if (text.height + 24 > height) {
            main.scaleY *= (text.height + 24) / height;
            syncMaskObject(main);
        }
        text.setCoords(); main.setCoords();
        canvas.requestRenderAll();
    }
    function finishEditing() {
        const active = canvas.getActiveObject();
        if (active && active.isEditing) active.exitEditing();
    }
    function cancelInsert() {
        inserting = false; start = null;
        if (preview) canvas.remove(preview);
        preview = null; canvas.skipTargetFind = false;
        canvas.defaultCursor = 'default'; button.removeAttribute('aria-pressed');
        canvas.requestRenderAll();
    }
    button.onclick = () => {
        finishEditing(); canvas.discardActiveObject();
        cancelInsert(); inserting = true; canvas.skipTargetFind = true;
        canvas.defaultCursor = 'crosshair'; button.setAttribute('aria-pressed', 'true');
        showToast(message);
    };
    function inside(main, point) {
        const center = main.getCenterPoint();
        const local = fabric.util.rotatePoint(point, center, -fabric.util.degreesToRadians(main.angle));
        const x = Math.abs(local.x - center.x), y = Math.abs(local.y - center.y);
        const w = main.getScaledWidth() / 2, h = main.getScaledHeight() / 2;
        const margin = 14; // 7 screen pixels at the existing 50% zoom.
        if (main.bubbleType === 'ellipse') return x*x/((w-margin)**2) + y*y/((h-margin)**2) < 1;
        return x < w - margin && y < h - margin;
    }
    canvas.on('mouse:down:before', e => {
        pendingEdit = null;
        if (inserting || !e.target || !e.target.isMainBubble || e.target.__corner) return;
        if (inside(e.target, canvas.getPointer(e.e))) {
            pendingEdit = e.target;
            pendingEdit.lockMovementX = pendingEdit.lockMovementY = true;
        }
    });
    canvas.on('mouse:down', e => {
        if (!inserting) return;
        start = canvas.getPointer(e.e);
        preview = new fabric.Rect({ left: start.x, top: start.y, width: 1, height: 1,
            fill: 'rgba(33,150,243,0.08)', stroke: '#2196f3', strokeWidth: 2,
            strokeDashArray: [8, 5], selectable: false, evented: false });
        canvas.add(preview);
    });
    canvas.on('mouse:move', e => {
        if (!start || !preview) return;
        const end = canvas.getPointer(e.e);
        preview.set({ left: Math.min(start.x, end.x), top: Math.min(start.y, end.y),
            width: Math.abs(end.x-start.x), height: Math.abs(end.y-start.y) });
        canvas.requestRenderAll();
    });
    canvas.on('mouse:up', e => {
        if (inserting && start) {
            const end = canvas.getPointer(e.e), origin = start;
            const width = Math.abs(end.x-origin.x), height = Math.abs(end.y-origin.y);
            cancelInsert();
            const drawn = Math.max(width, height) > 10;
            const main = createBubble(drawn ? (end.x+origin.x)/2 : origin.x,
                drawn ? (end.y+origin.y)/2 : origin.y);
            if (drawn) {
                main.scaleX *= Math.max(80, width) / main.getScaledWidth();
                main.scaleY *= Math.max(60, height) / main.getScaledHeight();
                if (main.linkedTail) moveTailAction(null, {target: main.linkedTail},
                    main.left, main.top + main.getScaledHeight()/2 + 100);
                syncMaskObject(main);
            }
            layoutText(main);
            main._lastScaleX = main.scaleX; main._lastScaleY = main.scaleY;
            return;
        }
        if (pendingEdit) {
            const main = pendingEdit; pendingEdit = null;
            main.lockMovementX = main.lockMovementY = false;
            const text = main.linkedText;
            canvas.setActiveObject(text); text.evented = true;
            text.enterEditing(); text.selectionStart = text.selectionEnd = text.text.length;
            text.hiddenTextarea.focus({preventScroll: true});
            canvas.requestRenderAll();
        }
    });
    canvas.on('text:editing:exited', e => {
        const text = e.target;
        text.evented = false;
        if (text.parentBubble && canvas.getActiveObject() === text)
            canvas.setActiveObject(text.parentBubble);
    });
    canvas.on('text:changed', e => layoutText(e.target.parentBubble));
    ['object:moving', 'object:scaling', 'object:rotating', 'object:modified'].forEach(name =>
        canvas.on(name, e => { if (e.target.isMainBubble) layoutText(e.target); }));
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') {
            cancelInsert(); finishEditing();
            e.preventDefault(); return;
        }
        if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable) return;
        const active = canvas.getActiveObject();
        if (active && active.isMainBubble && ['Delete', 'Backspace'].includes(e.key)) {
            deleteObject(null, {target: active}); canvas.discardActiveObject(); e.preventDefault();
        }
    });
    const originalUpdate = updateActiveText;
    updateActiveText = (prop, value) => {
        if (prop === 'fontSize' && (!Number.isFinite(value) || value < 10 || value > 200)) return;
        originalUpdate(prop, value);
        const active = canvas.getActiveObject();
        const main = active && (active.isMainBubble ? active : active.parentBubble);
        if (main) layoutText(main);
    };
    const originalExport = document.getElementById('exportBtn').onclick;
    document.getElementById('exportBtn').onclick = () => {
        cancelInsert(); finishEditing(); originalExport();
    };
})();
