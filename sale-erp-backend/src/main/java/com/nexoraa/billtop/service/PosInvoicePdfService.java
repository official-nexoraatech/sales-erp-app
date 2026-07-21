package com.nexoraa.billtop.service;

import com.lowagie.text.Document;
import com.lowagie.text.DocumentException;
import com.lowagie.text.Element;
import com.lowagie.text.Font;
import com.lowagie.text.Image;
import com.lowagie.text.PageSize;
import com.lowagie.text.Paragraph;
import com.lowagie.text.Phrase;
import com.lowagie.text.Rectangle;
import com.lowagie.text.pdf.PdfPCell;
import com.lowagie.text.pdf.PdfPTable;
import com.lowagie.text.pdf.PdfWriter;
import com.nexoraa.billtop.constants.ErrorMessage;
import com.nexoraa.billtop.entity.Address;
import com.nexoraa.billtop.entity.Contact;
import com.nexoraa.billtop.entity.Organization;
import com.nexoraa.billtop.entity.Sale;
import com.nexoraa.billtop.entity.SalesItem;
import com.nexoraa.billtop.exception.ResourceNotFoundException;
import com.nexoraa.billtop.repository.AddressRepository;
import com.nexoraa.billtop.repository.OrganizationRepository;
import com.nexoraa.billtop.repository.SaleRepository;
import com.nexoraa.billtop.repository.SalesItemRepository;
import com.nexoraa.billtop.security.CurrentOrganizationService;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

import java.awt.Color;
import java.io.ByteArrayOutputStream;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.net.URI;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * Renders a POS sale as an A4 "Bold Statement" invoice PDF - a dark forest-and-gold
 * brand band, item table and a gold grand-total callout, matching the invoice
 * direction picked for the app.
 */
@Service
public class PosInvoicePdfService {

    private static final String BILLING_ADDRESS_TYPE = "BILLING";
    private static final DateTimeFormatter INVOICE_DATE_FORMAT = DateTimeFormatter.ofPattern("dd MMM yyyy");
    private static final DateTimeFormatter FILE_TIMESTAMP_FORMAT = DateTimeFormatter.ofPattern("yyyyMMdd_HHmmss");

    private static final Color BAND_COLOR = new Color(0x17, 0x33, 0x2C);
    private static final Color GOLD_COLOR = new Color(0xC9, 0xA2, 0x4B);
    private static final Color INK_COLOR = new Color(0x1B, 0x23, 0x1F);
    private static final Color MUTED_COLOR = new Color(0x6E, 0x7A, 0x72);
    private static final Color ROW_SHADE_COLOR = new Color(0xF3, 0xEE, 0xDF);
    private static final Color ROW_BORDER_COLOR = new Color(0xE7, 0xE0, 0xCB);
    private static final Color DUE_COLOR = new Color(0x8A, 0x3B, 0x2A);
    private static final Color BAND_MUTED_COLOR = new Color(0xC9, 0xC0, 0xA6);

    private static final String[] ONES = {
            "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
            "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"
    };
    private static final String[] TENS = {
            "", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"
    };

    private final SaleRepository saleRepository;
    private final SalesItemRepository salesItemRepository;
    private final OrganizationRepository organizationRepository;
    private final AddressRepository addressRepository;
    private final CurrentOrganizationService currentOrganizationService;

    public PosInvoicePdfService(
            SaleRepository saleRepository,
            SalesItemRepository salesItemRepository,
            OrganizationRepository organizationRepository,
            AddressRepository addressRepository,
            CurrentOrganizationService currentOrganizationService
    ) {
        this.saleRepository = saleRepository;
        this.salesItemRepository = salesItemRepository;
        this.organizationRepository = organizationRepository;
        this.addressRepository = addressRepository;
        this.currentOrganizationService = currentOrganizationService;
    }

    public record InvoicePdf(byte[] content, String fileName) {
    }

    @Transactional(readOnly = true)
    public InvoicePdf generateInvoicePdf(Long saleId) {
        Long organizationId = currentOrganizationService.getOrganizationId();
        Sale sale = saleRepository.findByIdAndOrganizationIdAndIsDeletedFalse(saleId, organizationId)
                .orElseThrow(() -> new ResourceNotFoundException(ErrorMessage.SALE_NOT_FOUND, "SALE_NOT_FOUND"));
        Organization organization = organizationRepository.findById(organizationId)
                .orElseThrow(() -> new ResourceNotFoundException(ErrorMessage.ORGANIZATION_NOT_FOUND, "ORGANIZATION_NOT_FOUND"));
        List<SalesItem> items = salesItemRepository.findBySaleIdAndOrganizationId(saleId, organizationId);
        Address customerAddress = sale.getCustomer() == null
                ? null
                : addressRepository.findByContactIdAndAddressTypeAndOrganizationId(
                        sale.getCustomer().getId(),
                        BILLING_ADDRESS_TYPE,
                        organizationId
                ).orElse(null);

        try {
            byte[] content = render(sale, organization, items, customerAddress);
            return new InvoicePdf(content, buildFileName(sale));
        } catch (DocumentException ex) {
            throw new IllegalStateException("Failed to generate invoice PDF", ex);
        }
    }

    private byte[] render(Sale sale, Organization organization, List<SalesItem> items, Address customerAddress) throws DocumentException {
        Document document = new Document(PageSize.A4, 28, 28, 28, 28);
        ByteArrayOutputStream outputStream = new ByteArrayOutputStream();
        PdfWriter.getInstance(document, outputStream);
        document.open();

        document.add(buildBand(organization, sale));

        PdfPTable parties = buildPartiesTable(sale, customerAddress);
        parties.setSpacingBefore(16f);
        document.add(parties);

        PdfPTable itemsTable = buildItemsTable(items);
        itemsTable.setSpacingBefore(18f);
        document.add(itemsTable);

        PdfPTable totals = buildTotalsSection(sale);
        totals.setSpacingBefore(14f);
        document.add(totals);

        document.close();
        return outputStream.toByteArray();
    }

    private PdfPTable buildBand(Organization organization, Sale sale) {
        PdfPTable band = new PdfPTable(new float[]{2.3f, 1f});
        band.setWidthPercentage(100);

        PdfPTable brandInner = new PdfPTable(new float[]{1f, 4.2f});
        brandInner.setWidthPercentage(100);
        addLogoCell(brandInner, organization);

        PdfPCell brandTextCell = new PdfPCell();
        brandTextCell.setBackgroundColor(BAND_COLOR);
        brandTextCell.setBorder(Rectangle.NO_BORDER);
        brandTextCell.setPaddingLeft(12f);
        brandTextCell.setVerticalAlignment(Element.ALIGN_MIDDLE);
        Paragraph brandName = paragraph(
                organization.getName() == null ? "" : organization.getName().toUpperCase(Locale.ROOT),
                15f, Font.BOLD, Color.WHITE, Element.ALIGN_LEFT
        );
        brandName.setSpacingAfter(3f);
        brandTextCell.addElement(brandName);
        brandTextCell.addElement(paragraph(organizationMetaLine(organization), 8f, Font.NORMAL, BAND_MUTED_COLOR, Element.ALIGN_LEFT));
        brandInner.addCell(brandTextCell);

        PdfPCell brandOuter = new PdfPCell(brandInner);
        brandOuter.setBackgroundColor(BAND_COLOR);
        brandOuter.setBorder(Rectangle.NO_BORDER);
        brandOuter.setPadding(14f);
        band.addCell(brandOuter);

        PdfPCell mastheadCell = new PdfPCell();
        mastheadCell.setBackgroundColor(BAND_COLOR);
        mastheadCell.setBorder(Rectangle.NO_BORDER);
        mastheadCell.setPadding(14f);
        mastheadCell.setVerticalAlignment(Element.ALIGN_MIDDLE);
        mastheadCell.addElement(paragraph("INVOICE", 8.5f, Font.BOLD, GOLD_COLOR, Element.ALIGN_RIGHT));
        Paragraph number = paragraph(sale.getInvoiceNo(), 13f, Font.BOLD, Color.WHITE, Element.ALIGN_RIGHT);
        number.setSpacingBefore(3f);
        mastheadCell.addElement(number);
        Paragraph meta = paragraph(formatInvoiceMeta(sale), 8f, Font.NORMAL, BAND_MUTED_COLOR, Element.ALIGN_RIGHT);
        meta.setSpacingBefore(2f);
        mastheadCell.addElement(meta);
        band.addCell(mastheadCell);

        return band;
    }

    private void addLogoCell(PdfPTable table, Organization organization) {
        PdfPCell cell = new PdfPCell();
        cell.setBackgroundColor(BAND_COLOR);
        cell.setBorder(Rectangle.NO_BORDER);
        cell.setPadding(0f);
        cell.setVerticalAlignment(Element.ALIGN_MIDDLE);
        cell.setHorizontalAlignment(Element.ALIGN_CENTER);

        Image logo = loadLogo(organization.getLogoUrl());
        if (logo != null) {
            logo.scaleToFit(40f, 40f);
            cell.addElement(logo);
        } else {
            PdfPTable monogram = new PdfPTable(1);
            monogram.setWidthPercentage(100);
            PdfPCell monogramCell = new PdfPCell(new Phrase(
                    initials(organization.getName()),
                    new Font(Font.HELVETICA, 14f, Font.BOLD, BAND_COLOR)
            ));
            monogramCell.setBackgroundColor(GOLD_COLOR);
            monogramCell.setBorder(Rectangle.NO_BORDER);
            monogramCell.setPadding(9f);
            monogramCell.setHorizontalAlignment(Element.ALIGN_CENTER);
            monogramCell.setVerticalAlignment(Element.ALIGN_MIDDLE);
            monogram.addCell(monogramCell);
            cell.addElement(monogram);
        }
        table.addCell(cell);
    }

    private Image loadLogo(String logoUrl) {
        if (!StringUtils.hasText(logoUrl)) {
            return null;
        }
        try {
            return Image.getInstance(URI.create(logoUrl).toURL());
        } catch (Exception ex) {
            return null;
        }
    }

    private String initials(String name) {
        if (!StringUtils.hasText(name)) {
            return "??";
        }
        StringBuilder builder = new StringBuilder();
        for (String part : name.trim().split("\\s+")) {
            if (!part.isEmpty()) {
                builder.append(Character.toUpperCase(part.charAt(0)));
            }
            if (builder.length() >= 2) {
                break;
            }
        }
        return builder.isEmpty() ? "??" : builder.toString();
    }

    private PdfPTable buildPartiesTable(Sale sale, Address customerAddress) {
        PdfPTable table = new PdfPTable(new float[]{1f, 1f});
        table.setWidthPercentage(100);

        Font labelFont = new Font(Font.HELVETICA, 7.5f, Font.BOLD, MUTED_COLOR);
        Font nameFont = new Font(Font.HELVETICA, 10.5f, Font.BOLD, INK_COLOR);
        Font detailFont = new Font(Font.HELVETICA, 8.5f, Font.NORMAL, INK_COLOR);

        table.addCell(buildPartyCell("BILLED TO", contactName(sale.getCustomer()),
                customerDetailLines(sale.getCustomer(), customerAddress), labelFont, nameFont, detailFont));
        table.addCell(buildPartyCell("STATUS", statusLabel(sale.getStatus()),
                paymentDetailLines(sale), labelFont, nameFont, detailFont));

        return table;
    }

    private PdfPCell buildPartyCell(String label, String name, List<String> detailLines, Font labelFont, Font nameFont, Font detailFont) {
        PdfPCell cell = new PdfPCell();
        cell.setBorder(Rectangle.NO_BORDER);

        Paragraph labelPara = new Paragraph(label, labelFont);
        labelPara.setSpacingAfter(4f);
        cell.addElement(labelPara);

        Paragraph namePara = new Paragraph(name, nameFont);
        namePara.setSpacingAfter(2f);
        cell.addElement(namePara);

        for (String line : detailLines) {
            cell.addElement(new Paragraph(line, detailFont));
        }
        return cell;
    }

    private PdfPTable buildItemsTable(List<SalesItem> items) {
        PdfPTable table = new PdfPTable(new float[]{3f, 1f, 1.1f, 0.9f, 1.2f});
        table.setWidthPercentage(100);

        Font headerFont = new Font(Font.HELVETICA, 8.5f, Font.BOLD, Color.WHITE);
        addHeaderCell(table, "ITEM", Element.ALIGN_LEFT, headerFont);
        addHeaderCell(table, "QTY", Element.ALIGN_RIGHT, headerFont);
        addHeaderCell(table, "RATE", Element.ALIGN_RIGHT, headerFont);
        addHeaderCell(table, "TAX", Element.ALIGN_RIGHT, headerFont);
        addHeaderCell(table, "AMOUNT", Element.ALIGN_RIGHT, headerFont);

        Font nameFont = new Font(Font.HELVETICA, 9.5f, Font.BOLD, INK_COLOR);
        Font subFont = new Font(Font.HELVETICA, 7.5f, Font.NORMAL, MUTED_COLOR);
        Font valueFont = new Font(Font.HELVETICA, 9.5f, Font.NORMAL, INK_COLOR);

        boolean shade = false;
        for (SalesItem item : items) {
            Color rowColor = shade ? ROW_SHADE_COLOR : Color.WHITE;

            PdfPCell nameCell = new PdfPCell();
            nameCell.setBackgroundColor(rowColor);
            nameCell.setBorder(Rectangle.BOTTOM);
            nameCell.setBorderColor(ROW_BORDER_COLOR);
            nameCell.setPadding(7f);
            Paragraph namePara = new Paragraph(item.getItem() == null ? "" : item.getItem().getItemName(), nameFont);
            namePara.setSpacingAfter(1.5f);
            nameCell.addElement(namePara);
            String subLine = itemSubLine(item);
            if (StringUtils.hasText(subLine)) {
                nameCell.addElement(new Paragraph(subLine, subFont));
            }
            table.addCell(nameCell);

            addBodyCell(table, formatQty(item.getQty()), Element.ALIGN_RIGHT, valueFont, rowColor);
            addBodyCell(table, formatMoney(item.getUnitPrice()), Element.ALIGN_RIGHT, valueFont, rowColor);
            addBodyCell(table, formatPercent(item.getTaxPercent()) + "%", Element.ALIGN_RIGHT, valueFont, rowColor);
            addBodyCell(table, formatMoney(item.getTotalAmount()), Element.ALIGN_RIGHT, valueFont, rowColor);

            shade = !shade;
        }

        return table;
    }

    private void addHeaderCell(PdfPTable table, String text, int alignment, Font font) {
        PdfPCell cell = new PdfPCell(new Phrase(text, font));
        cell.setBackgroundColor(BAND_COLOR);
        cell.setBorder(Rectangle.NO_BORDER);
        cell.setPadding(8f);
        cell.setHorizontalAlignment(alignment);
        table.addCell(cell);
    }

    private void addBodyCell(PdfPTable table, String text, int alignment, Font font, Color background) {
        PdfPCell cell = new PdfPCell(new Phrase(text, font));
        cell.setBackgroundColor(background);
        cell.setBorder(Rectangle.BOTTOM);
        cell.setBorderColor(ROW_BORDER_COLOR);
        cell.setPadding(7f);
        cell.setHorizontalAlignment(alignment);
        cell.setVerticalAlignment(Element.ALIGN_TOP);
        table.addCell(cell);
    }

    private PdfPTable buildTotalsSection(Sale sale) {
        PdfPTable wrapper = new PdfPTable(new float[]{1.3f, 1f});
        wrapper.setWidthPercentage(100);

        Font noteLabelFont = new Font(Font.HELVETICA, 8f, Font.BOLD, MUTED_COLOR);
        Font noteFont = new Font(Font.HELVETICA, 8.5f, Font.NORMAL, INK_COLOR);
        Font wordsFont = new Font(Font.HELVETICA, 8f, Font.ITALIC, MUTED_COLOR);

        PdfPCell noteCell = new PdfPCell();
        noteCell.setBorder(Rectangle.NO_BORDER);
        Paragraph noteLabel = new Paragraph("NOTES", noteLabelFont);
        noteLabel.setSpacingAfter(4f);
        noteCell.addElement(noteLabel);
        String notes = StringUtils.hasText(sale.getNotes())
                ? sale.getNotes()
                : "Goods once sold will not be taken back or exchanged. Thank you for your business.";
        noteCell.addElement(new Paragraph(notes, noteFont));
        Paragraph words = new Paragraph("Amount in words: " + toWords(sale.getGrandTotal()), wordsFont);
        words.setSpacingBefore(8f);
        noteCell.addElement(words);
        wrapper.addCell(noteCell);

        PdfPCell totalsCell = new PdfPCell();
        totalsCell.setBorder(Rectangle.NO_BORDER);

        PdfPTable rows = new PdfPTable(new float[]{1f, 1f});
        rows.setWidthPercentage(100);
        addTotalRow(rows, "Subtotal", formatMoney(sale.getSubTotal()));
        addTotalRow(rows, "Discount", "-" + formatMoney(sale.getDiscountAmount()));
        addTotalRow(rows, "Tax", formatMoney(sale.getTaxAmount()));
        addTotalRow(rows, "Round off", formatMoney(sale.getRoundOff()));
        totalsCell.addElement(rows);

        PdfPTable grandBar = new PdfPTable(new float[]{1f, 1f});
        grandBar.setWidthPercentage(100);
        grandBar.setSpacingBefore(8f);
        PdfPCell grandLabel = new PdfPCell(new Phrase("TOTAL DUE", new Font(Font.HELVETICA, 10f, Font.BOLD, Color.WHITE)));
        grandLabel.setBackgroundColor(BAND_COLOR);
        grandLabel.setBorder(Rectangle.NO_BORDER);
        grandLabel.setPadding(10f);
        grandLabel.setVerticalAlignment(Element.ALIGN_MIDDLE);
        PdfPCell grandAmount = new PdfPCell(new Phrase(formatMoney(sale.getGrandTotal()), new Font(Font.HELVETICA, 15f, Font.BOLD, GOLD_COLOR)));
        grandAmount.setBackgroundColor(BAND_COLOR);
        grandAmount.setBorder(Rectangle.NO_BORDER);
        grandAmount.setPadding(10f);
        grandAmount.setHorizontalAlignment(Element.ALIGN_RIGHT);
        grandAmount.setVerticalAlignment(Element.ALIGN_MIDDLE);
        grandBar.addCell(grandLabel);
        grandBar.addCell(grandAmount);
        totalsCell.addElement(grandBar);

        BigDecimal due = sale.getDueAmount();
        if (due != null && due.compareTo(BigDecimal.ZERO) > 0) {
            Paragraph duePara = new Paragraph(formatMoney(due) + " outstanding", new Font(Font.HELVETICA, 9f, Font.BOLD, DUE_COLOR));
            duePara.setAlignment(Element.ALIGN_RIGHT);
            duePara.setSpacingBefore(6f);
            totalsCell.addElement(duePara);
        }

        wrapper.addCell(totalsCell);
        return wrapper;
    }

    private void addTotalRow(PdfPTable table, String label, String value) {
        Font labelFont = new Font(Font.HELVETICA, 9f, Font.NORMAL, MUTED_COLOR);
        Font valueFont = new Font(Font.HELVETICA, 9f, Font.NORMAL, INK_COLOR);

        PdfPCell labelCell = new PdfPCell(new Phrase(label, labelFont));
        labelCell.setBorder(Rectangle.NO_BORDER);
        labelCell.setPadding(3f);
        table.addCell(labelCell);

        PdfPCell valueCell = new PdfPCell(new Phrase(value, valueFont));
        valueCell.setBorder(Rectangle.NO_BORDER);
        valueCell.setPadding(3f);
        valueCell.setHorizontalAlignment(Element.ALIGN_RIGHT);
        table.addCell(valueCell);
    }

    private Paragraph paragraph(String text, float size, int style, Color color, int alignment) {
        Paragraph paragraph = new Paragraph(text == null ? "" : text, new Font(Font.HELVETICA, size, style, color));
        paragraph.setAlignment(alignment);
        return paragraph;
    }

    private String organizationMetaLine(Organization organization) {
        StringBuilder builder = new StringBuilder();
        if (organization.getAddress() != null) {
            builder.append(addressLine(organization.getAddress()));
        }
        if (StringUtils.hasText(organization.getGstNumber())) {
            if (!builder.isEmpty()) {
                builder.append("  |  ");
            }
            builder.append("GSTIN ").append(organization.getGstNumber());
        }
        return builder.toString();
    }

    private String addressLine(Address address) {
        List<String> parts = new ArrayList<>();
        if (StringUtils.hasText(address.getAddressLine1())) {
            parts.add(address.getAddressLine1());
        }
        if (StringUtils.hasText(address.getAddressLine2())) {
            parts.add(address.getAddressLine2());
        }
        if (StringUtils.hasText(address.getCity())) {
            parts.add(address.getCity());
        }
        if (address.getState() != null && StringUtils.hasText(address.getState().getStateName())) {
            parts.add(address.getState().getStateName());
        }
        if (StringUtils.hasText(address.getPincode())) {
            parts.add(address.getPincode());
        }
        return String.join(", ", parts);
    }

    private String formatInvoiceMeta(Sale sale) {
        String date = sale.getInvoiceDate() == null ? "" : sale.getInvoiceDate().format(INVOICE_DATE_FORMAT);
        String warehouse = sale.getWarehouse() == null ? "" : sale.getWarehouse().getName();
        return StringUtils.hasText(warehouse) ? date + "  ·  " + warehouse : date;
    }

    private String contactName(Contact contact) {
        if (contact == null) {
            return "Walk-in Customer";
        }
        String full = ((contact.getFirstName() == null ? "" : contact.getFirstName())
                + " " + (contact.getLastName() == null ? "" : contact.getLastName())).trim();
        return full.isEmpty() ? "Walk-in Customer" : full;
    }

    private List<String> customerDetailLines(Contact contact, Address address) {
        List<String> lines = new ArrayList<>();
        if (address != null) {
            String line = addressLine(address);
            if (StringUtils.hasText(line)) {
                lines.add(line);
            }
        }
        if (contact != null && StringUtils.hasText(contact.getGstNumber())) {
            lines.add("GSTIN " + contact.getGstNumber());
        }
        if (contact != null && StringUtils.hasText(contact.getMobile())) {
            lines.add("Mobile " + contact.getMobile());
        }
        return lines;
    }

    private List<String> paymentDetailLines(Sale sale) {
        List<String> lines = new ArrayList<>();
        lines.add("Paid " + formatMoney(sale.getPaidAmount()) + " of " + formatMoney(sale.getGrandTotal()));
        BigDecimal due = sale.getDueAmount();
        lines.add(due != null && due.compareTo(BigDecimal.ZERO) > 0 ? "Due on receipt" : "No balance due");
        return lines;
    }

    private String statusLabel(String status) {
        if (!StringUtils.hasText(status)) {
            return "Unpaid";
        }
        return switch (status.toUpperCase(Locale.ROOT)) {
            case "PAID" -> "Paid";
            case "PARTIAL", "PARTIALLY_PAID" -> "Partially paid";
            case "UNPAID", "DUE", "PENDING" -> "Unpaid";
            default -> capitalize(status);
        };
    }

    private String capitalize(String value) {
        String lower = value.toLowerCase(Locale.ROOT).replace('_', ' ').trim();
        return lower.isEmpty() ? "" : Character.toUpperCase(lower.charAt(0)) + lower.substring(1);
    }

    private String itemSubLine(SalesItem item) {
        List<String> parts = new ArrayList<>();
        if (item.getItem() != null && StringUtils.hasText(item.getItem().getHsnCode())) {
            parts.add("HSN " + item.getItem().getHsnCode());
        }
        if (item.getBatch() != null && StringUtils.hasText(item.getBatch().getBatchNo())) {
            parts.add("Batch " + item.getBatch().getBatchNo());
        }
        return String.join(" · ", parts);
    }

    private String formatQty(BigDecimal qty) {
        if (qty == null) {
            return "0";
        }
        BigDecimal stripped = qty.stripTrailingZeros();
        return stripped.scale() <= 0 ? stripped.toBigInteger().toString() : stripped.toPlainString();
    }

    private String formatPercent(BigDecimal percent) {
        if (percent == null) {
            return "0";
        }
        BigDecimal stripped = percent.stripTrailingZeros();
        return stripped.scale() <= 0 ? stripped.toBigInteger().toString() : stripped.toPlainString();
    }

    /**
     * Rupee-sign glyph isn't in the base-14 PDF font encodings used here, so amounts
     * use an "Rs." prefix instead of embedding a Unicode font just for one symbol.
     */
    private String formatMoney(BigDecimal value) {
        BigDecimal amount = value == null ? BigDecimal.ZERO : value;
        boolean negative = amount.signum() < 0;
        BigDecimal absolute = amount.abs().setScale(2, RoundingMode.HALF_UP);
        String[] parts = absolute.toPlainString().split("\\.");
        String integerPart = parts[0];
        String decimalPart = parts.length > 1 ? parts[1] : "00";

        String grouped;
        int length = integerPart.length();
        if (length <= 3) {
            grouped = integerPart;
        } else {
            String lastThree = integerPart.substring(length - 3);
            String remaining = integerPart.substring(0, length - 3);
            StringBuilder remainingGrouped = new StringBuilder();
            int remLength = remaining.length();
            int firstGroupLen = remLength % 2 == 0 ? 2 : 1;
            remainingGrouped.append(remaining, 0, firstGroupLen);
            int index = firstGroupLen;
            while (index < remLength) {
                remainingGrouped.append(',').append(remaining, index, index + 2);
                index += 2;
            }
            grouped = remainingGrouped + "," + lastThree;
        }
        return (negative ? "-" : "") + "Rs. " + grouped + "." + decimalPart;
    }

    private String toWords(BigDecimal amount) {
        long rupees = amount == null ? 0 : amount.setScale(0, RoundingMode.DOWN).longValue();
        if (rupees == 0) {
            return "Rupees Zero Only";
        }
        StringBuilder words = new StringBuilder();
        long crore = rupees / 10000000;
        rupees %= 10000000;
        long lakh = rupees / 100000;
        rupees %= 100000;
        long thousand = rupees / 1000;
        rupees %= 1000;
        long hundred = rupees / 100;
        long remainder = rupees % 100;

        if (crore > 0) {
            words.append(twoDigitWords(crore)).append(" Crore ");
        }
        if (lakh > 0) {
            words.append(twoDigitWords(lakh)).append(" Lakh ");
        }
        if (thousand > 0) {
            words.append(twoDigitWords(thousand)).append(" Thousand ");
        }
        if (hundred > 0) {
            words.append(ONES[(int) hundred]).append(" Hundred ");
        }
        if (remainder > 0) {
            if (!words.isEmpty()) {
                words.append("and ");
            }
            words.append(twoDigitWords(remainder));
        }
        return "Rupees " + words.toString().trim() + " Only";
    }

    private String twoDigitWords(long value) {
        if (value < 20) {
            return ONES[(int) value];
        }
        long tensDigit = value / 10;
        long onesDigit = value % 10;
        return TENS[(int) tensDigit] + (onesDigit > 0 ? " " + ONES[(int) onesDigit] : "");
    }

    private String buildFileName(Sale sale) {
        String safeName = contactName(sale.getCustomer())
                .replaceAll("[^A-Za-z0-9]+", "_")
                .replaceAll("^_+|_+$", "");
        if (safeName.isBlank()) {
            safeName = "Invoice";
        }
        return safeName + "_" + LocalDateTime.now().format(FILE_TIMESTAMP_FORMAT) + ".pdf";
    }
}
