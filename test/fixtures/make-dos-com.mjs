// Synthetic DOS fixture: a hand-assembled 8086 .COM (our own bytes, MIT). VGA mode 13h, then every vertical retrace
// it redraws the screen as diagonal stripes of the whole palette, shifted one colour per frame, until a key is pressed;
// then text mode and exit. (The brief's listing filled the screen with ONE colour per frame (mov al,bl / rep stosb):
// verify's blank rule counts a flat frame as blank (luma std < 2), so pixel colour here is (offset + frame) instead.)

export function makeAnimCom() {
  return Buffer.from([
    // org 100h
    0xB8, 0x13, 0x00, //       mov ax,13h          ; VGA mode 13h (320x200x256)
    0xCD, 0x10, //             int 10h
    0xB8, 0x00, 0xA0, //       mov ax,0A000h
    0x8E, 0xC0, //             mov es,ax           ; es = video memory
    0x30, 0xDB, //             xor bl,bl           ; bl = frame number
    // frame: (offset 12)
    0xBA, 0xDA, 0x03, //       mov dx,3DAh         ; VGA input status 1
    // w1: (15)
    0xEC, //                   in al,dx
    0xA8, 0x08, //             test al,8
    0x75, 0xFB, //             jnz w1              ; wait for vsync end
    // w2: (20)
    0xEC, //                   in al,dx
    0xA8, 0x08, //             test al,8
    0x74, 0xFB, //             jz w2               ; wait for vsync start
    0x31, 0xFF, //             xor di,di
    0xB9, 0x00, 0xFA, //       mov cx,64000
    // fill: (30)
    0x89, 0xF8, //             mov ax,di
    0x00, 0xD8, //             add al,bl           ; colour = offset + frame (mod 256)
    0xAA, //                   stosb
    0xE2, 0xF9, //             loop fill           ; (37 - 7 = 30)
    0xFE, 0xC3, //             inc bl
    0xB4, 0x01, //             mov ah,1
    0xCD, 0x16, //             int 16h             ; key waiting? (ZF=1: no)
    0x74, 0xDF, //             jz frame            ; loop until a key is pressed (45 - 33 = 12)
    0x30, 0xE4, //             xor ah,ah
    0xCD, 0x16, //             int 16h             ; consume the key
    0xB8, 0x03, 0x00, //       mov ax,3
    0xCD, 0x10, //             int 10h             ; text mode
    0xC3, //                   ret                 ; to PSP:0 (int 20h): exit
  ]);
}
