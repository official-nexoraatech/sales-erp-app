# Hardware Setup Guide — Barcode Scanner, Label Printer, Receipt Printer

## Version 1.0 | Cloth Retail ERP

This ERP does not use custom hardware drivers. Every device listed below is installed as a
**normal device on the till's operating system** (Windows/Linux/macOS) — the browser-based
POS and back-office apps talk to it the same way any webpage prints or reads keyboard input.
There is nothing to install on the ERP side beyond the usual browser.

---

## Barcode Scanner (USB or Bluetooth)

Any standard "keyboard wedge" barcode scanner works — these are the vast majority of
retail-counter scanners and need no special driver.

1. Plug the scanner into a USB port (or pair it over Bluetooth, if wireless).
2. Windows/most OSes detect it automatically as a keyboard — no driver install needed.
3. Open the POS screen (`/pos`) and click into the barcode input at the top — it's focused
   by default when the screen loads.
4. Scan a barcode. The scanner "types" the code and presses Enter for you; the item is added
   automatically with a beep and a green flash. A red flash + error message means that
   barcode isn't in the system yet.
5. No scanner on hand (e.g. a tablet till)? Tap the 📷 button next to the barcode input to
   scan with the device's camera instead.

Supported symbologies: EAN-13, EAN-8, UPC, CODE128, CODE39, and QR — the scanner/camera reads
the code and sends the raw value; the ERP doesn't care which symbology produced it.

## Label Printer (for product barcode labels)

1. Install the label printer as a normal system printer using the manufacturer's Windows/Linux
   driver (the same driver CD/download the printer ships with).
2. In the ERP, go to **Production → Barcode Labels**, pick an item, a quantity, a label size
   (40×25mm, 50×25mm, 60×40mm, 100×50mm, or a full A4 sheet), and a symbology.
3. Click **Generate & Preview**, confirm the preview looks right, then **Print Labels** — this
   opens the browser's print dialog. Select the label printer there and print.

## Billing / Receipt Printer

Works the same way as the label printer — install it as a normal system printer, then print
from the browser.

- **A4 invoices**: open any confirmed invoice and click **Print / Download PDF**.
- **POS counter receipts**: after completing a sale, the receipt screen lets you choose
  **58mm**, **80mm**, or **A4** paper size before printing — pick whichever matches the
  printer installed at that till. The choice is remembered for next time.
- No printer at the till, or the customer prefers a digital copy? Use the **WhatsApp** or
  **Email** button on the receipt screen instead (requires the customer to be selected on
  the sale, with a phone/email on file and not opted out of that channel).

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Scanner types into the wrong field | Click the barcode input first — some scanners rely on it having keyboard focus |
| Nothing happens on scan | The value isn't a known barcode/name match — try the camera scanner or search by name |
| Print dialog shows the wrong printer selected by default | Change the OS default printer, or pick the right one in the print dialog each time |
| Labels print the wrong size | Confirm the label size selected in **Barcode Labels** matches the stock loaded in the printer |
