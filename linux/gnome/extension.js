import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Pango from 'gi://Pango';
import Shell from 'gi://Shell';
import St from 'gi://St';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {monitorAt, pickSlice, shortcutLabel, wheelPlacement} from './geometry.js';
import {PINGS, EMOTES} from './catalog.js';

const SHORTCUTS = ['ping-shortcut', 'emote-shortcut', 'pause-shortcut'];
const MAX_EFFECTS = 16;

function easeWhenMapped(actor, params) {
    // Clutter skips implicit transitions until the actor is both mapped AND allocated.
    // Allocation notifications run during relayout, which also suppresses transitions.
    const startAfterLayout = () => {
        const destroyId = actor.connect('destroy', () => GLib.Source.remove(source));
        const source = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            actor.disconnect(destroyId);
            const {duration, mode, onComplete, ...properties} = params;
            const entries = Object.entries(properties);
            // Explicit property transitions also work on actors that have not painted yet.
            entries.forEach(([name, value], index) => {
                const options = {duration, mode};
                if (onComplete && index === entries.length - 1) options.onComplete = onComplete;
                actor.ease_property(name.replaceAll('_', '-'), value, options);
            });
            return GLib.SOURCE_REMOVE;
        });
    };
    if (actor.mapped && actor.has_allocation()) {
        startAfterLayout();
    } else {
        const ids = [];
        const ready = () => {
            if (!actor.mapped || !actor.has_allocation()) return;
            ids.forEach(id => actor.disconnect(id));
            startAfterLayout();
        };
        ids.push(actor.connect('notify::mapped', ready));
        ids.push(actor.connect('notify::allocation', ready));
    }
}

export default class LolPingExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._effects = new Set();
        this._timers = new Set();
        this._sounds = new Set();
        this._wheel = null;
        this._lastSound = 0;
        this._registeredKeys = [];
        try {
            this._indicator = new PanelMenu.Button(0.0, 'lolPing');
            this._panelIcon = this._icon('textures/enemy_missing.png', 20);
            this._indicator.add_child(this._panelIcon);
            Main.panel.addToStatusArea(this.uuid, this._indicator);
            this._pingItem = this._indicator.menu.addAction('', () => this._afterMenu('ping'));
            this._emoteItem = this._indicator.menu.addAction('', () => this._afterMenu('emote'));
            this._indicator.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
            this._pauseItem = new PopupMenu.PopupSwitchMenuItem('暂停', this._settings.get_boolean('paused'));
            this._pauseItem.connect('toggled', (_item, state) => this._settings.set_boolean('paused', state));
            this._indicator.menu.addMenuItem(this._pauseItem);
            this._soundItem = new PopupMenu.PopupSwitchMenuItem('音效', this._settings.get_boolean('sound'));
            this._soundItem.connect('toggled', (_item, state) => this._settings.set_boolean('sound', state));
            this._indicator.menu.addMenuItem(this._soundItem);
            this._indicator.menu.addAction('设置与使用说明', () => this.openPreferences());
            this._indicator.menu.addAction('关闭扩展', () => Main.extensionManager.disableExtension(this.uuid));

            this._settingsId = this._settings.connect('changed', (_settings, key) => {
                this._refreshMenu();
                if (key === 'paused' && this._settings.get_boolean('paused')) {
                    this._closeWheel();
                    this._clearEffects();
                }
                if (key === 'sound' && !this._settings.get_boolean('sound'))
                    this._stopSounds();
            });
            this._refreshMenu();
            const callbacks = [() => this._openWheel('ping'), () => this._openWheel('emote'), () => {
                this._settings.set_boolean('paused', !this._settings.get_boolean('paused'));
                Main.notify('lolPing', this._settings.get_boolean('paused') ? '已暂停' : '已恢复');
            }];
            SHORTCUTS.forEach((key, i) => {
                const action = Main.wm.addKeybinding(key, this._settings, Meta.KeyBindingFlags.IGNORE_AUTOREPEAT,
                    Shell.ActionMode.NORMAL, callbacks[i]);
                this._registeredKeys.push(key);
                if (action === Meta.KeyBindingAction.NONE)
                    Main.notify('lolPing', `快捷键注册失败，请在设置中修改：${key}`);
            });
            this._monitorId = Main.layoutManager.connect('monitors-changed', () => {
                this._closeWheel();
                this._clearEffects();
            });
            this._sessionId = Main.sessionMode.connect('updated', () => {
                if (Main.sessionMode.isLocked || Main.sessionMode.isGreeter) {
                    this._closeWheel();
                    this._clearEffects();
                }
            });
            this._overviewId = Main.overview.connect('showing', () => this._closeWheel());
        } catch (error) {
            this.disable();
            throw error;
        }
    }

    _icon(relative, size) {
        return new St.Icon({gicon: new Gio.FileIcon({file: this.dir.get_child(`assets/${relative}`)}),
            icon_size: size, width: size, height: size, reactive: false});
    }

    _refreshMenu() {
        const label = key => shortcutLabel(this._settings.get_strv(key)[0] ?? '未设置');
        this._pingItem.label.text = `信号轮盘  ·  ${label('ping-shortcut')}`;
        this._emoteItem.label.text = `表情轮盘  ·  ${label('emote-shortcut')}`;
        const paused = this._settings.get_boolean('paused');
        this._pauseItem.setToggleState(paused);
        this._soundItem.setToggleState(this._settings.get_boolean('sound'));
        this._panelIcon.opacity = paused ? 100 : 255;
        this._pingItem.setSensitive(!paused);
        this._emoteItem.setSensitive(!paused);
    }

    _later(ms, callback) {
        const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
            this._timers.delete(id);
            try { callback(); } catch (error) { console.error(`lolPing: ${error.stack ?? error}`); }
            return GLib.SOURCE_REMOVE;
        });
        this._timers.add(id);
        return id;
    }

    _removeTimer(id) {
        if (id && this._timers.delete(id)) GLib.Source.remove(id);
    }

    _afterMenu(kind) {
        // Let PopupMenu release its grab before acquiring ours.
        this._later(200, () => this._openWheel(kind));
    }

    _openWheel(kind) {
        if (this._settings.get_boolean('paused') || Main.sessionMode.isLocked || Main.sessionMode.isGreeter || Main.overview.visible)
            return false;
        if (this._wheel) {
            this._closeWheel();
            return false;
        }
        const [anchorX, anchorY] = global.get_pointer();
        const monitor = monitorAt(anchorX, anchorY, Main.layoutManager.monitors);
        if (!monitor) return false;
        const placement = wheelPlacement(anchorX, anchorY, monitor);
        const root = new St.Widget({reactive: true, can_focus: true, x: 0, y: 0,
            width: global.stage.width, height: global.stage.height, layout_manager: new Clutter.FixedLayout()});
        const wheel = {root, kind, anchorX, anchorY, ...placement, selected: -1,
            items: kind === 'emote' ? EMOTES : PINGS.slice(0, 8), icons: [], grab: null, timeout: 0};
        this._wheel = wheel;
        Main.uiGroup.add_child(root);
        try {
            const diameter = placement.radius * 2;
            const drawing = new St.DrawingArea({width: diameter, height: diameter,
                x: placement.x - placement.radius, y: placement.y - placement.radius});
            wheel.drawing = drawing;
            root.add_child(drawing);
            drawing.connect('repaint', () => this._paintWheel(wheel));
            for (let i = 0; i < 8; i++) {
                const item = wheel.items[i];
                const icon = this._icon(item.icon, Math.round(46 * placement.scale));
                const angle = (i * 45 - 90) * Math.PI / 180;
                icon.set_position(placement.x + Math.cos(angle) * 112 * placement.scale - icon.width / 2,
                    placement.y + Math.sin(angle) * 112 * placement.scale - icon.height / 2);
                icon.opacity = 185;
                icon.set_pivot_point(0.5, 0.5);
                root.add_child(icon);
                wheel.icons.push(icon);
            }
            wheel.label = new St.Label({text: '取消', style_class: 'lolping-center',
                x: placement.x - 72 * placement.scale, y: placement.y - 15,
                width: 144 * placement.scale});
            root.add_child(wheel.label);
            wheel.hint = new St.Label({text: '左键确认 · Esc 取消\n数字 1–8 快选', style_class: 'lolping-hint',
                y: placement.y + 16});
            wheel.hint.clutter_text.set_line_alignment(Pango.Alignment.CENTER);
            root.add_child(wheel.hint);
            wheel.hint.x = placement.x - wheel.hint.get_preferred_width(-1)[1] / 2;
            root.connect('motion-event', (_actor, event) => {
                this._selectAt(...event.get_coords());
                return Clutter.EVENT_STOP;
            });
            root.connect('button-press-event', (_actor, event) => {
                if (event.get_button() === 3) this._closeWheel();
                return Clutter.EVENT_STOP;
            });
            root.connect('button-release-event', (_actor, event) => {
                if (event.get_button() === 1) this._confirm();
                return Clutter.EVENT_STOP;
            });
            root.connect('scroll-event', () => Clutter.EVENT_STOP);
            root.connect('key-press-event', (_actor, event) => {
                const key = event.get_key_symbol();
                if (key === Clutter.KEY_Escape) this._closeWheel();
                else if (key === Clutter.KEY_Return || key === Clutter.KEY_KP_Enter) this._confirm();
                else if (key >= Clutter.KEY_1 && key <= Clutter.KEY_8) {
                    this._select(key - Clutter.KEY_1);
                    this._confirm();
                }
                return Clutter.EVENT_STOP;
            });
            root.connect('key-release-event', () => Clutter.EVENT_STOP);
            wheel.grab = Main.pushModal(root, {actionMode: Shell.ActionMode.POPUP});
            if ((wheel.grab.get_seat_state() & Clutter.GrabState.ALL) !== Clutter.GrabState.ALL) {
                this._closeWheel();
                return false;
            }
            root.grab_key_focus();
            wheel.timeout = this._later(this._settings.get_int('wheel-timeout') * 1000, () => this._closeWheel());
            return true;
        } catch (error) {
            this._closeWheel();
            console.error(`lolPing wheel: ${error.stack ?? error}`);
            return false;
        }
    }

    _paintWheel(wheel) {
        const cr = wheel.drawing.get_context();
        try {
            cr.translate(wheel.radius, wheel.radius);
            cr.scale(wheel.scale, wheel.scale);
            cr.setSourceRGBA(0.025, 0.055, 0.085, 0.96);
            cr.arc(0, 0, 160, 0, Math.PI * 2);
            cr.fill();
            for (let i = 0; i < 8; i++) {
                const start = (i * 45 - 112.5) * Math.PI / 180 + 0.015;
                const end = start + Math.PI / 4 - 0.03;
                cr.arc(0, 0, 156, start, end);
                cr.arcNegative(0, 0, 76, end, start);
                cr.closePath();
                if (i === wheel.selected) cr.setSourceRGBA(0.10, 0.46, 0.60, 0.95);
                else cr.setSourceRGBA(0.10, 0.16, 0.20, 0.85);
                cr.fillPreserve();
                cr.setSourceRGBA(0.78, 0.66, 0.43, i === wheel.selected ? 1 : 0.48);
                cr.setLineWidth(1.2);
                cr.stroke();
            }
            cr.arc(0, 0, 160, 0, Math.PI * 2);
            cr.setSourceRGBA(0.78, 0.66, 0.43, 0.9);
            cr.setLineWidth(2);
            cr.stroke();
        } finally { cr.$dispose(); }
    }

    _selectAt(x, y) {
        const w = this._wheel;
        if (w) this._select(pickSlice((x - w.x) / w.scale, (y - w.y) / w.scale, 76));
    }

    _select(index) {
        const w = this._wheel;
        if (!w || w.selected === index) return;
        w.selected = index;
        w.label.text = index < 0 ? '取消' : w.items[index].name;
        w.icons.forEach((icon, i) => {
            icon.opacity = i === index ? 255 : 185;
            icon.scale_x = icon.scale_y = i === index ? 1.16 : 1;
        });
        w.drawing.queue_repaint();
    }

    _confirm() {
        const w = this._wheel;
        if (!w) return;
        const item = w.items[w.selected];
        const {anchorX, anchorY, kind} = w;
        this._closeWheel();
        if (item) this._spawnEffect(item, anchorX, anchorY, kind);
    }

    _closeWheel() {
        const w = this._wheel;
        if (!w) return;
        this._wheel = null;
        this._removeTimer(w.timeout);
        if (w.grab) Main.popModal(w.grab);
        w.root.destroy();
    }

    _spawnEffect(item, x, y, kind = 'ping') {
        if (!this._settings || this._settings.get_boolean('paused')) return;
        while (this._effects.size >= MAX_EFFECTS) this._destroyEffect(this._effects.values().next().value);
        const size = this._settings.get_int('ping-size') * (kind === 'emote' ? 1.35 : 1);
        const duration = this._settings.get_double('duration') * 1000;
        const actor = new St.Widget({reactive: false, width: size * 2, height: size * 2,
            x: x - size, y: y - size, layout_manager: new Clutter.FixedLayout()});
        const effect = {actor, timers: new Set()};
        this._effects.add(effect);
        Main.uiGroup.add_child(actor);
        if (kind === 'ping') {
            for (const delay of [0, 220, 1200]) {
                const timer = this._later(delay, () => {
                    effect.timers.delete(timer);
                    const ring = new St.Widget({width: size, height: size, x: size / 2, y: size / 2,
                        reactive: false, style: `border: 3px solid ${item.color}; border-radius: ${Math.round(size)}px;`});
                    ring.set_pivot_point(0.5, 0.5);
                    ring.scale_x = ring.scale_y = 0.25;
                    actor.add_child(ring);
                    easeWhenMapped(ring, {scale_x: 1.4, scale_y: 1.4, opacity: 0, duration: 650,
                        mode: Clutter.AnimationMode.EASE_OUT_QUAD, onComplete: () => ring.destroy()});
                });
                effect.timers.add(timer);
            }
        }
        const art = new St.Widget({width: size, height: size, x: size / 2,
            y: size / 2 - (kind === 'ping' ? size * 0.2 : 0), reactive: false});
        actor.add_child(art);
        art.set_pivot_point(0.5, 0.5);
        art.scale_x = art.scale_y = 0.35;
        for (const file of item.art) art.add_child(this._icon(file, Math.round(size)));
        easeWhenMapped(art, {scale_x: 1, scale_y: 1, duration: 280, mode: Clutter.AnimationMode.EASE_OUT_BACK});
        const fade = this._later(Math.max(300, duration - 350), () => {
            effect.timers.delete(fade);
            actor.ease({opacity: 0, duration: 350, onComplete: () => this._destroyEffect(effect)});
        });
        effect.timers.add(fade);
        this._playSound(item);
    }

    _playSound(item) {
        const now = GLib.get_monotonic_time();
        if (!this._settings.get_boolean('sound') || now - this._lastSound < 80000) return;
        this._lastSound = now;
        // Native asynchronous sound player; follows GNOME's Sound Effects volume.
        const cancellable = new Gio.Cancellable();
        this._sounds.add(cancellable);
        try {
            global.display.get_sound_player().play_from_file(this.dir.get_child(`assets/${item.sound}`), item.name, cancellable);
        } catch (error) { console.error(`lolPing sound: ${error.message}`); }
        this._later(6000, () => { cancellable.cancel(); this._sounds.delete(cancellable); });
    }

    _stopSounds() {
        for (const cancellable of this._sounds ?? []) cancellable.cancel();
        this._sounds?.clear();
    }

    _destroyEffect(effect) {
        if (!this._effects.delete(effect)) return;
        for (const timer of effect.timers) this._removeTimer(timer);
        effect.actor.destroy();
    }

    _clearEffects() {
        for (const effect of [...this._effects ?? []]) this._destroyEffect(effect);
        this._stopSounds();
    }

    disable() {
        this._closeWheel();
        this._clearEffects();
        for (const timer of this._timers ?? []) GLib.Source.remove(timer);
        this._timers?.clear();
        for (const key of this._registeredKeys ?? []) Main.wm.removeKeybinding(key);
        this._registeredKeys = [];
        if (this._monitorId) Main.layoutManager.disconnect(this._monitorId);
        if (this._sessionId) Main.sessionMode.disconnect(this._sessionId);
        if (this._overviewId) Main.overview.disconnect(this._overviewId);
        if (this._settingsId) this._settings.disconnect(this._settingsId);
        this._monitorId = this._sessionId = this._overviewId = this._settingsId = 0;
        this._indicator?.destroy();
        this._indicator = null;
        this._settings = null;
    }
}
