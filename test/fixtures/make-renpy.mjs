// Synthetic Ren'Py 8 game (our own script, MIT; spike h): a main menu with a sliding label (the picture changes every
// frame), two dialogue lines and a two-way choice. renpy/vc_version.py names the Ren'Py version, as an install's does;
// the SDK compiles the .rpy files during the build.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const SCRIPT = `# port-any-game test fixture (MIT)
define p = Character("Pag")
default choice = None

transform pag_slide:
    xalign 0.0 yalign 0.9
    linear 1.0 xalign 1.0
    linear 1.0 xalign 0.0
    repeat

screen main_menu():
    tag menu
    add Solid("#203060")
    text "PAG" size 90 color "#ffffff" at pag_slide
    vbox:
        xalign 0.5 yalign 0.4 spacing 20
        text "PAG Renpy Fixture" size 56 color "#ffcc00"
        textbutton "Start" action Start()

label main_menu:
    call screen main_menu
    return

label start:
    scene expression Solid("#305020")
    p "Hello from the port-any-game Ren'Py fixture."
    p "A click or Enter shows the next line."
    menu:
        "Red":
            $ choice = "red"
        "Blue":
            $ choice = "blue"
    p "You chose [choice]."
    return
`;

const OPTIONS = `# port-any-game test fixture (MIT)
define config.name = "PAG Renpy Fixture"
define config.version = "1.0"
define build.name = "pagfixture"
define config.save_directory = "pagfixture-1"
`;

export function makeRenpy(dir, { version = '8.6.1.26111705' } = {}) {
  mkdirSync(path.join(dir, 'game'), { recursive: true });
  mkdirSync(path.join(dir, 'renpy'), { recursive: true });
  writeFileSync(path.join(dir, 'game', 'script.rpy'), SCRIPT);
  writeFileSync(path.join(dir, 'game', 'options.rpy'), OPTIONS);
  writeFileSync(path.join(dir, 'renpy', 'vc_version.py'), `# port-any-game test fixture (MIT)\nversion = '${version}'\n`);
  return dir;
}
