"""Write the sample PDFs used by the smoke test and the manual test guide.

Usage: python scripts/make_samples.py
All names and text are invented.
"""
from pathlib import Path

import fitz

OUT = Path(__file__).resolve().parent.parent / "samples"

AGREEMENT = [
    "This Equipment Rental Agreement is made between Northwind Tool Library",
    "(\"Lender\") and the person signing below (\"Borrower\").",
    "",
    "1. Items. Lender rents to Borrower the items listed in Schedule A.",
    "2. Term. The rental starts on the date signed and ends after 14 days.",
    "3. Care. Borrower returns the items clean and in working order.",
    "4. Fees. A late fee of $5 per day applies after the end of the term.",
    "5. Damage. Borrower pays the repair cost of any damage beyond normal wear.",
    "6. Whole agreement. This page and Schedule A are the whole agreement.",
]


def lines(page, x, y, rows, size=11):
    for row in rows:
        page.insert_text((x, y), row, fontsize=size, fontname="helv")
        y += size * 1.6
    return y


def signature_block(page, y, who):
    page.insert_text((72, y), f"{who} signature", fontsize=9, fontname="helv", color=(0.35, 0.35, 0.35))
    page.draw_line((72, y - 14), (330, y - 14), color=(0, 0, 0), width=0.8)
    page.insert_text((360, y), "Date", fontsize=9, fontname="helv", color=(0.35, 0.35, 0.35))
    page.draw_line((360, y - 14), (540, y - 14), color=(0, 0, 0), width=0.8)
    page.insert_text((72, y + 34), "Initials", fontsize=9, fontname="helv", color=(0.35, 0.35, 0.35))
    page.draw_line((72, y + 20), (150, y + 20), color=(0, 0, 0), width=0.8)


def agreement(doc):
    p = doc.new_page(width=612, height=792)
    p.insert_text((72, 90), "Equipment Rental Agreement", fontsize=20, fontname="hebo")
    y = lines(p, 72, 130, AGREEMENT)
    signature_block(p, y + 90, "Borrower")
    signature_block(p, y + 200, "Lender")
    p2 = doc.new_page(width=612, height=792)
    p2.insert_text((72, 90), "Schedule A", fontsize=16, fontname="hebo")
    lines(p2, 72, 130, ["Cordless drill with two batteries", "Orbital sander", "Six-foot step ladder"])
    p2.insert_text((72, 300), "Borrower initials", fontsize=9, fontname="helv", color=(0.35, 0.35, 0.35))
    p2.draw_line((72, 286), (180, 286), color=(0, 0, 0), width=0.8)


def main() -> None:
    OUT.mkdir(exist_ok=True)

    doc = fitz.open()
    agreement(doc)
    doc.save(OUT / "rental-agreement.pdf")

    doc = fitz.open()
    agreement(doc)
    doc[0].set_rotation(90)
    doc.save(OUT / "rotated-page.pdf")

    # Owner-password protection with an empty open password: opens anywhere,
    # but pdf-lib cannot rewrite it, so YepSign saves a flattened copy.
    doc = fitz.open()
    agreement(doc)
    perms = fitz.PDF_PERM_PRINT | fitz.PDF_PERM_PRINT_HQ | fitz.PDF_PERM_ACCESSIBILITY
    doc.save(OUT / "protected-printing-allowed.pdf", encryption=fitz.PDF_ENCRYPT_AES_256, owner_pw="owner-secret", user_pw="", permissions=perms)

    doc = fitz.open()
    agreement(doc)
    doc.save(OUT / "protected-no-printing.pdf", encryption=fitz.PDF_ENCRYPT_AES_256, owner_pw="owner-secret", user_pw="", permissions=fitz.PDF_PERM_ACCESSIBILITY)

    print("wrote", ", ".join(sorted(p.name for p in OUT.glob("*.pdf"))))


if __name__ == "__main__":
    main()
