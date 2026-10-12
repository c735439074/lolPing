import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class LolPingPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        window.set_default_size(640, 720);
        const page = new Adw.PreferencesPage({title: 'lolPing', icon_name: 'input-gaming-symbolic'});
        window.add(page);
        const usage = new Adw.PreferencesGroup({title: '桌面信号与表情',
            description: '按快捷键呼出，移动鼠标选择，左键点击确认。信号落在呼出时的鼠标位置。Esc、右键或中心区域取消；数字 1–8 可直接选择。'});
        page.add(usage);
        for (const [key, title, subtitle] of [
            ['paused', '暂停', '暂停时关闭轮盘并清除正在显示的效果'],
            ['sound', '播放原版音效', '音量跟随 Ubuntu 设置 → 声音 → 系统声音'],
        ]) {
            const row = new Adw.SwitchRow({title, subtitle});
            settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
            usage.add(row);
        }
        const appearance = new Adw.PreferencesGroup({title: '显示'});
        page.add(appearance);
        for (const [key, title, min, max, step, digits] of [
            ['ping-size', '信号大小（逻辑像素）', 64, 220, 4, 0],
            ['duration', '显示时长（秒）', 1, 6, 0.2, 1],
            ['wheel-timeout', '轮盘自动关闭（秒）', 3, 30, 1, 0],
        ]) {
            const adjustment = new Gtk.Adjustment({lower: min, upper: max, step_increment: step, page_increment: step * 5});
            const row = new Adw.SpinRow({title, adjustment, digits});
            settings.bind(key, adjustment, 'value', Gio.SettingsBindFlags.DEFAULT);
            appearance.add(row);
        }
        const shortcuts = new Adw.PreferencesGroup({title: '快捷键',
            description: '使用 GTK 格式，例如 &lt;Super&gt;&lt;Shift&gt;p。Super 就是键盘上的 Win 键。输入后按回车或点击应用按钮保存。'});
        page.add(shortcuts);
        const keys = ['ping-shortcut', 'emote-shortcut', 'pause-shortcut'];
        keys.forEach((key, i) => {
            const row = new Adw.EntryRow({title: ['信号轮盘', '表情轮盘', '暂停 / 恢复'][i],
                text: settings.get_strv(key)[0] ?? '', show_apply_button: true});
            const save = () => {
                const value = row.text.trim();
                const [ok, keyval, mods] = Gtk.accelerator_parse(value);
                const primary = Gdk.ModifierType.CONTROL_MASK | Gdk.ModifierType.ALT_MASK | Gdk.ModifierType.SUPER_MASK;
                if (!ok || !Gtk.accelerator_valid(keyval, mods) || !(mods & primary)) {
                    window.add_toast(new Adw.Toast({title: '快捷键需包含 Ctrl、Alt 或 Super，以及一个普通按键'}));
                    return;
                }
                const normalized = Gtk.accelerator_name(keyval, mods);
                const duplicate = keys.some(other => other !== key && settings.get_strv(other).some(accel => {
                    const [valid, k, m] = Gtk.accelerator_parse(accel);
                    return valid && k === keyval && m === mods;
                }));
                if (duplicate) {
                    window.add_toast(new Adw.Toast({title: '这个快捷键已用于另一个 lolPing 操作'}));
                    return;
                }
                settings.set_strv(key, [normalized]);
                row.text = normalized;
            };
            row.connect('apply', save);
            shortcuts.add(row);
        });
        const about = new Adw.PreferencesGroup({title: 'Ubuntu 适配版 · 0.1.0',
            description: '适用于 Ubuntu 24.04 / GNOME 46（Wayland 和 X11）。复用 lolPing 的图标与音效，使用原生桌面扩展实现。表情为静态图加弹出动画；此版不包含好友房间、自定义图片与自动更新。启用扩展后会随桌面会话加载。'});
        page.add(about);
        about.add(new Adw.ActionRow({title: '来源：darrenprx/lolPing',
            subtitle: '代码：MIT；游戏图标、音效：© Riot Games。本适配非官方发行版。'}));
    }
}
