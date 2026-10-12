// Test-only extension, loaded in an isolated headless GNOME session by integration.py.
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const wait = ms => new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
    resolve(); return GLib.SOURCE_REMOVE;
}));
const results = [];
async function screenshot(name) {
    const file = Gio.File.new_for_path(`${GLib.getenv('LOLPING_TEST_DIR')}/${name}.png`);
    const stream = file.replace(null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
    try { await new Shell.Screenshot().screenshot(false, stream); }
    finally { stream.close(null); }
}
function check(condition, message) {
    if (!condition) throw new Error(message);
    results.push(message);
    console.log(`LOLPING_TEST PASS: ${message}`);
}

export default class TestExtension extends Extension {
    enable() {
        this.run().catch(error => {
            this.finish({ok: false, results, error: `${error}\n${error.stack ?? ''}`});
        });
    }
    disable() {}

    async run() {
        await wait(3000);
        Main.overview.hide();
        await wait(1000);
        const ext = Main.extensionManager.lookup('lolping-ubuntu@local');
        check(ext?.state === 1, `extension enabled (state=${ext?.state}, error=${ext?.error})`);
        const app = ext.stateObj;
        app.openPreferences();
        await wait(3000);
        const windows = global.get_window_actors().map(actor => actor.meta_window);
        const prefsWindow = windows.find(window => window.get_title().includes('lolPing'));
        check(Boolean(prefsWindow), `native preferences window opens (${windows.map(w => w.get_title()).join(', ')})`);
        await screenshot('preferences');
        const baselineModals = Main.modalCount;
        const seat = Clutter.get_default_backend().get_default_seat();
        const pointer = seat.create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
        const keyboard = seat.create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
        const motion = (x, y) => pointer.notify_absolute_motion(GLib.get_monotonic_time(), x, y);
        const key = async sym => {
            keyboard.notify_keyval(GLib.get_monotonic_time(), sym, Clutter.KeyState.PRESSED);
            await wait(30);
            keyboard.notify_keyval(GLib.get_monotonic_time(), sym, Clutter.KeyState.RELEASED);
            await wait(70);
        };
        const shortcut = async sym => {
            for (const mod of [Clutter.KEY_Super_L, Clutter.KEY_Shift_L])
                keyboard.notify_keyval(GLib.get_monotonic_time(), mod, Clutter.KeyState.PRESSED);
            await key(sym);
            for (const mod of [Clutter.KEY_Shift_L, Clutter.KEY_Super_L])
                keyboard.notify_keyval(GLib.get_monotonic_time(), mod, Clutter.KeyState.RELEASED);
            await wait(150);
        };
        app._settings.set_boolean('sound', false);
        motion(640, 400);
        await wait(100);
        await shortcut(Clutter.KEY_p);
        check(app._wheel?.kind === 'ping', 'real Super+Shift+P opens the ping wheel');
        check(prefsWindow && !prefsWindow.minimized, 'wheel opens above a real GTK Wayland application');
        check(Main.modalCount === baselineModals + 1, 'wheel owns one input grab');
        const {x, y, anchorX, anchorY} = app._wheel;
        motion(x - 115, y);
        await wait(150);
        check(app._wheel.selected === 6, 'real pointer motion selects enemy missing');
        await screenshot('wheel');
        pointer.notify_button(GLib.get_monotonic_time(), 1, Clutter.ButtonState.PRESSED);
        await wait(30);
        pointer.notify_button(GLib.get_monotonic_time(), 1, Clutter.ButtonState.RELEASED);
        await wait(20);
        check(app._wheel === null && Main.modalCount === baselineModals, 'real click confirms and releases input');
        check(app._effects.size === 1, 'confirmation creates one desktop effect');
        const effect = app._effects.values().next().value;
        check(effect.actor.get_children().some(actor => actor.get_transition('opacity')),
            'pulse rings animate after their actors are mapped');
        check(!effect.actor.reactive && Math.abs(effect.actor.x + effect.actor.width / 2 - anchorX) < 1
            && Math.abs(effect.actor.y + effect.actor.height / 2 - anchorY) < 1,
        'effect is click-through and remains at the original pointer position');
        await screenshot('ping');
        await wait(3400);
        check(app._effects.size === 0, 'effect expires without leaving an actor');
        await shortcut(Clutter.KEY_e);
        check(app._wheel?.kind === 'emote', 'real Super+Shift+E opens the emote wheel');
        await key(Clutter.KEY_1);
        check(app._effects.size === 1 && !app._wheel, 'number key confirms an emote');
        await wait(300);
        await screenshot('emote');
        app._clearEffects();
        await shortcut(Clutter.KEY_p);
        await key(Clutter.KEY_Escape);
        check(!app._wheel && app._effects.size === 0 && Main.modalCount === baselineModals, 'Escape cancels without a ping or leaked grab');
        app._openWheel('ping');
        pointer.notify_button(GLib.get_monotonic_time(), 3, Clutter.ButtonState.PRESSED);
        await wait(30);
        pointer.notify_button(GLib.get_monotonic_time(), 3, Clutter.ButtonState.RELEASED);
        await wait(80);
        check(!app._wheel && Main.modalCount === baselineModals, 'right-click cancels');
        app._openWheel('ping');
        app._confirm();
        check(!app._wheel && app._effects.size === 0, 'confirming the dead zone cancels');
        app._settings.set_int('wheel-timeout', 3);
        app._openWheel('ping');
        await wait(3300);
        check(!app._wheel && Main.modalCount === baselineModals, 'timeout releases keyboard and pointer');
        await shortcut(Clutter.KEY_o);
        check(app._settings.get_boolean('paused') && !app._openWheel('ping'), 'pause shortcut blocks the wheel');
        await shortcut(Clutter.KEY_o);
        check(!app._settings.get_boolean('paused'), 'pause shortcut resumes');
        app._settings.set_boolean('sound', true);
        app._openWheel('ping');
        app._select(0);
        app._confirm();
        check(app._sounds.size === 1, 'native sound player call succeeds');
        app._settings.set_boolean('paused', true);
        check(app._effects.size === 0 && app._sounds.size === 0, 'pause clears live effects and sound handles');
        app._settings.set_boolean('paused', false);
        app._settings.set_boolean('sound', false);
        const secondMonitor = Main.layoutManager.monitors[1];
        check(Boolean(secondMonitor), 'two virtual monitors are available');
        motion(secondMonitor.x + secondMonitor.width - 2, secondMonitor.y + 2);
        await wait(100);
        app._openWheel('ping');
        check(app._wheel.x + app._wheel.radius <= secondMonitor.x + secondMonitor.width
            && app._wheel.y - app._wheel.radius >= secondMonitor.y,
        'wheel at secondary monitor edge remains visible');
        app._closeWheel();
        // Unloading while a wheel is open must release all owned resources.
        app._openWheel('ping');
        app.disable();
        check(Main.modalCount === baselineModals && app._timers.size === 0 && app._effects.size === 0
            && app._indicator === null, 'disable releases input, panel, actors and timers');
        app.enable();
        check(app._openWheel('ping'), 'extension can be re-enabled after cleanup');
        app._closeWheel();
        await wait(100);
        this.finish({ok: true, results});
    }

    finish(result) {
        GLib.file_set_contents(`${GLib.getenv('LOLPING_TEST_DIR')}/result.json`, JSON.stringify(result, null, 2));
        console.log(`LOLPING_TEST ${result.ok ? 'SUCCESS' : 'FAILURE'} ${result.error ?? ''}`);
        global.context.terminate();
    }
}
