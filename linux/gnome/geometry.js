// Screen coordinates: north is slot 0, then clockwise, matching src/shared/geometry.ts.
export function pickSlice(dx, dy, deadZone = 52) {
    if (!Number.isFinite(dx) || !Number.isFinite(dy) || Math.hypot(dx, dy) < deadZone)
        return -1;
    return Math.floor((Math.atan2(dy, dx) * 180 / Math.PI + 472.5) % 360 / 45) % 8;
}

export function wheelPlacement(x, y, monitor, requestedRadius = 164) {
    const radius = Math.max(1, Math.min(requestedRadius, (monitor.width - 16) / 2, (monitor.height - 16) / 2));
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(v, hi));
    return {
        x: clamp(x, monitor.x + radius + 8, monitor.x + monitor.width - radius - 8),
        y: clamp(y, monitor.y + radius + 8, monitor.y + monitor.height - radius - 8),
        radius,
        scale: radius / 164,
    };
}

export function monitorAt(x, y, monitors) {
    return monitors.find(m => x >= m.x && x < m.x + m.width && y >= m.y && y < m.y + m.height)
        ?? monitors[0];
}

export function shortcutLabel(accelerator) {
    return accelerator.replace(/<Super>/gi, 'Super + ').replace(/<Shift>/gi, 'Shift + ')
        .replace(/<Control>|<Primary>/gi, 'Ctrl + ').replace(/<Alt>/gi, 'Alt + ')
        .replace(/([a-z])$/, c => c.toUpperCase());
}
