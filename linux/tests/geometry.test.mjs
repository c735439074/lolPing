import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

// Import without changing the upstream package.json module mode or requiring npm.
const code = readFileSync(new URL('../gnome/geometry.js', import.meta.url), 'utf8');
const {pickSlice, wheelPlacement, monitorAt} = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);

test('eight compass directions match the upstream wheel, including diagonals', () => {
    [[0, -100], [100, -100], [100, 0], [100, 100], [0, 100], [-100, 100], [-100, 0], [-100, -100]]
        .forEach(([x, y], index) => assert.equal(pickSlice(x, y), index));
});
test('dead zone cancels, invalid coordinates cannot select an item', () => {
    assert.equal(pickSlice(0, 0), -1);
    assert.equal(pickSlice(51, 0), -1);
    assert.equal(pickSlice(52, 0), 2);
    assert.equal(pickSlice(NaN, 0), -1);
    assert.equal(pickSlice(Infinity, 0), -1);
    assert.equal(pickSlice(70, 0, 76), -1);
});
test('wheel stays visible at all edges, including negative monitor coordinates', () => {
    const monitor = {x: -1920, y: -200, width: 1920, height: 1080};
    for (const x of [-1920, -1000, -1]) for (const y of [-200, 300, 879]) {
        const w = wheelPlacement(x, y, monitor);
        assert.ok(w.x - w.radius >= monitor.x);
        assert.ok(w.y - w.radius >= monitor.y);
        assert.ok(w.x + w.radius <= monitor.x + monitor.width);
        assert.ok(w.y + w.radius <= monitor.y + monitor.height);
    }
});
test('small displays scale the wheel, monitor boundaries select the correct display', () => {
    const m = {x: 0, y: 0, width: 200, height: 200};
    const w = wheelPlacement(0, 0, m);
    assert.ok(w.scale < 1);
    assert.ok(w.x + w.radius <= 200);
    const monitors = [{x: -1920, y: 0, width: 1920, height: 1080}, {x: 0, y: 0, width: 2560, height: 1440}];
    assert.equal(monitorAt(-1, 100, monitors), monitors[0]);
    assert.equal(monitorAt(0, 100, monitors), monitors[1]);
    assert.equal(monitorAt(2559, 100, monitors), monitors[1]);
});
