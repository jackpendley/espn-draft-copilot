// Renders the panel as a normal extension page. Because this runs on the
// chrome-extension:// origin it keeps all host permissions, so pick sync works
// even if content-script injection into ESPN is broken.
import { h, render } from 'preact';
import { Panel } from './Panel.js';

render(h(Panel), document.querySelector('.dc-shell'));
