package com.nexoraa.billtop.service;

import com.nexoraa.billtop.dto.contact.excel.ContactExcelImportMessageDto;
import com.nexoraa.billtop.dto.contact.excel.ContactExcelImportResponseDto;
import com.nexoraa.billtop.entity.Branch;
import com.nexoraa.billtop.entity.Contact;
import com.nexoraa.billtop.entity.Address;
import com.nexoraa.billtop.entity.Organization;
import com.nexoraa.billtop.entity.State;
import com.nexoraa.billtop.exception.BadRequestException;
import com.nexoraa.billtop.repository.AddressRepository;
import com.nexoraa.billtop.repository.ContactRepository;
import com.nexoraa.billtop.repository.StateRepository;
import com.nexoraa.billtop.security.CurrentBranchService;
import com.nexoraa.billtop.security.CurrentOrganizationService;
import org.apache.poi.ss.usermodel.BorderStyle;
import org.apache.poi.ss.usermodel.Cell;
import org.apache.poi.ss.usermodel.CellStyle;
import org.apache.poi.ss.usermodel.CellType;
import org.apache.poi.ss.usermodel.DataFormat;
import org.apache.poi.ss.usermodel.DataFormatter;
import org.apache.poi.ss.usermodel.DataValidation;
import org.apache.poi.ss.usermodel.DataValidationConstraint;
import org.apache.poi.ss.usermodel.DataValidationHelper;
import org.apache.poi.ss.usermodel.DateUtil;
import org.apache.poi.ss.usermodel.FillPatternType;
import org.apache.poi.ss.usermodel.Font;
import org.apache.poi.ss.usermodel.HorizontalAlignment;
import org.apache.poi.ss.usermodel.IndexedColors;
import org.apache.poi.ss.usermodel.Row;
import org.apache.poi.ss.usermodel.Sheet;
import org.apache.poi.ss.usermodel.VerticalAlignment;
import org.apache.poi.ss.usermodel.Workbook;
import org.apache.poi.ss.usermodel.WorkbookFactory;
import org.apache.poi.ss.util.CellRangeAddress;
import org.apache.poi.ss.util.CellRangeAddressList;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;
import org.springframework.web.multipart.MultipartFile;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.Locale;
import java.util.Optional;

@Service
public class ContactExcelService {

    public static final String TEMPLATE_FILE_NAME = "Contacts-Import-Format.xlsx";
    private static final String CONTACT_SHEET = "Contact Details";
    private static final String CUSTOMER = "CUSTOMER";
    private static final String SUPPLIER = "SUPPLIER";
    private static final String BILLING = "BILLING";
    private static final String SHIPPING = "SHIPPING";
    private static final String PAYABLE = "PAYABLE";
    private static final String RECEIVABLE = "RECEIVABLE";
    private static final BigDecimal ZERO = BigDecimal.ZERO;

    private static final int CONTACT_TYPE = 0;
    private static final int FIRST_NAME = 1;
    private static final int LAST_NAME = 2;
    private static final int EMAIL = 3;
    private static final int PHONE = 4;
    private static final int MOBILE = 5;
    private static final int WHATSAPP_NUMBER = 6;
    private static final int TAX_NUMBER = 7;
    private static final int STATE_NAME = 8;
    private static final int BILLING_ADDRESS = 9;
    private static final int SHIPPING_ADDRESS = 10;
    private static final int OPENING_BALANCE = 11;
    private static final int OPENING_DATE = 12;
    private static final int OPENING_BALANCE_TYPE = 13;
    private static final int CREDIT_LIMIT = 14;
    private static final int IS_WHOLESALE = 15;

    private final ContactRepository contactRepository;
    private final AddressRepository addressRepository;
    private final StateRepository stateRepository;
    private final CurrentOrganizationService currentOrganizationService;
    private final CurrentBranchService currentBranchService;

    public ContactExcelService(
            ContactRepository contactRepository,
            AddressRepository addressRepository,
            StateRepository stateRepository,
            CurrentOrganizationService currentOrganizationService,
            CurrentBranchService currentBranchService
    ) {
        this.contactRepository = contactRepository;
        this.addressRepository = addressRepository;
        this.stateRepository = stateRepository;
        this.currentOrganizationService = currentOrganizationService;
        this.currentBranchService = currentBranchService;
    }

    public byte[] generateTemplate() {
        try (Workbook workbook = new XSSFWorkbook(); ByteArrayOutputStream outputStream = new ByteArrayOutputStream()) {
            CellStyle headerStyle = headerStyle(workbook);
            CellStyle textStyle = textStyle(workbook);
            CellStyle numberStyle = numberStyle(workbook);
            CellStyle dateStyle = dateStyle(workbook);

            Sheet sheet = workbook.createSheet(CONTACT_SHEET);
            createHeader(sheet, headerStyle, contactHeaders());
            addSampleRows(sheet, textStyle, numberStyle, dateStyle);
            addListValidation(sheet, CONTACT_TYPE, new String[]{"Customer", "Supplier"});
            addListValidation(sheet, OPENING_BALANCE_TYPE, new String[]{"To Pay", "To Receive", "PAYABLE", "RECEIVABLE"});
            addListValidation(sheet, IS_WHOLESALE, new String[]{"Yes", "No"});
            sizeColumns(sheet, contactHeaders().length);

            workbook.write(outputStream);
            return outputStream.toByteArray();
        } catch (IOException ex) {
            throw new BadRequestException("Unable to generate contact import template", "CONTACT_EXCEL_TEMPLATE_FAILED");
        }
    }

    @Transactional
    public ContactExcelImportResponseDto importContacts(MultipartFile file) {
        if (file == null || file.isEmpty()) {
            throw new BadRequestException("Excel file is required", "EXCEL_FILE_REQUIRED");
        }

        Long organizationId = currentOrganizationService.getOrganizationId();
        Organization organization = currentOrganizationService.getOrganizationReference();
        Long branchId = currentBranchService.getBranchId();
        Branch branch = currentBranchService.getBranchReference();
        ContactExcelImportResponseDto response = ContactExcelImportResponseDto.builder().build();
        DataFormatter formatter = new DataFormatter();

        try (InputStream inputStream = file.getInputStream(); Workbook workbook = WorkbookFactory.create(inputStream)) {
            Sheet sheet = findContactSheet(workbook);
            if (sheet == null) {
                throw new BadRequestException("Workbook must contain a contact sheet", "INVALID_CONTACT_EXCEL_FORMAT");
            }

            importRows(sheet, formatter, organizationId, organization, branchId, branch, response);
            response.setFailedRows((int) response.getErrors().stream()
                    .map(ContactExcelImportMessageDto::getRowNumber)
                    .distinct()
                    .count());
            return response;
        } catch (IOException ex) {
            throw new BadRequestException("Unable to read Excel file", "CONTACT_EXCEL_IMPORT_FAILED");
        }
    }

    private void importRows(
            Sheet sheet,
            DataFormatter formatter,
            Long organizationId,
            Organization organization,
            Long branchId,
            Branch branch,
            ContactExcelImportResponseDto response
    ) {
        for (int rowIndex = 1; rowIndex <= sheet.getLastRowNum(); rowIndex++) {
            Row row = sheet.getRow(rowIndex);
            if (isBlankRow(row, contactHeaders().length, formatter)) {
                continue;
            }
            response.setContactRows(response.getContactRows() + 1);

            String firstName = text(row, FIRST_NAME, formatter);
            String lastName = text(row, LAST_NAME, formatter);
            String contactName = displayName(firstName, lastName);
            String contactType = normalizeContactType(text(row, CONTACT_TYPE, formatter));
            if (!StringUtils.hasText(contactType)) {
                addError(response, rowIndex, contactName, "Contact Type is required and must be Customer or Supplier");
            }
            if (!StringUtils.hasText(firstName)) {
                addError(response, rowIndex, contactName, "First Name is required");
            }

            BigDecimal openingBalance = number(row, OPENING_BALANCE, formatter, ZERO, "Opening Balance", response, rowIndex, contactName);
            BigDecimal creditLimit = number(row, CREDIT_LIMIT, formatter, null, "Credit Limit", response, rowIndex, contactName);
            String openingBalanceType = normalizeOpeningBalanceType(text(row, OPENING_BALANCE_TYPE, formatter));
            if (StringUtils.hasText(text(row, OPENING_BALANCE_TYPE, formatter)) && !StringUtils.hasText(openingBalanceType)) {
                addError(response, rowIndex, contactName, "Opening Balance Type must be To Pay, To Receive, PAYABLE, or RECEIVABLE");
            }

            Boolean isWholesale = bool(row, IS_WHOLESALE, formatter, response, rowIndex, contactName);
            State state = findState(row, formatter, response, rowIndex, contactName);
            warnUnsupportedColumns(row, formatter, response, rowIndex, contactName);
            if (hasRowError(response, rowIndex)) {
                continue;
            }

            String email = text(row, EMAIL, formatter);
            String mobile = text(row, MOBILE, formatter);
            Contact contact = findExistingContact(contactType, mobile, email, firstName, lastName, organizationId, branchId)
                    .orElseGet(() -> newContact(organization, branch));
            boolean created = contact.getId() == null;

            contact.setOrganization(organization);
            contact.setBranch(branch);
            contact.setContactType(contactType);
            contact.setFirstName(limit(firstName, 100));
            contact.setLastName(limit(lastName, 100));
            contact.setEmail(limit(email, 150));
            contact.setPhone(limit(text(row, PHONE, formatter), 20));
            contact.setMobile(limit(mobile, 20));
            contact.setWhatsappNo(limit(text(row, WHATSAPP_NUMBER, formatter), 20));
            contact.setGstNumber(limit(text(row, TAX_NUMBER, formatter), 30));
            contact.setOpeningBalance(openingBalance);
            contact.setOpeningBalanceType(openingBalanceType);
            contact.setCreditLimit(creditLimit);
            contact.setIsWholesale(isWholesale);
            contact.setStatus(com.nexoraa.billtop.enums.Status.ACTIVE);
            if (created) {
            }
            Contact savedContact = contactRepository.save(contact);

            if (StringUtils.hasText(text(row, BILLING_ADDRESS, formatter))) {
                saveAddress(savedContact, text(row, BILLING_ADDRESS, formatter), BILLING, state, organization);
                response.setBillingAddressRows(response.getBillingAddressRows() + 1);
            }
            if (StringUtils.hasText(text(row, SHIPPING_ADDRESS, formatter))) {
                saveAddress(savedContact, text(row, SHIPPING_ADDRESS, formatter), SHIPPING, state, organization);
                response.setShippingAddressRows(response.getShippingAddressRows() + 1);
            }

            if (created) {
                response.setCreatedContacts(response.getCreatedContacts() + 1);
            } else {
                response.setUpdatedContacts(response.getUpdatedContacts() + 1);
            }
        }
    }

    private Optional<Contact> findExistingContact(
            String contactType,
            String mobile,
            String email,
            String firstName,
            String lastName,
            Long organizationId,
            Long branchId
    ) {
        if (StringUtils.hasText(mobile)) {
            Optional<Contact> contact = contactRepository.findFirstByContactTypeAndMobileAndOrganizationIdAndBranchIdAndStatus(
                    contactType,
                    mobile,
                    organizationId,
                    branchId,
            com.nexoraa.billtop.enums.Status.ACTIVE);
            if (contact.isPresent()) {
                return contact;
            }
        }
        if (StringUtils.hasText(email)) {
            Optional<Contact> contact = contactRepository.findFirstByContactTypeAndEmailIgnoreCaseAndOrganizationIdAndBranchIdAndStatus(
                    contactType,
                    email,
                    organizationId,
                    branchId,
            com.nexoraa.billtop.enums.Status.ACTIVE);
            if (contact.isPresent()) {
                return contact;
            }
        }
        if (StringUtils.hasText(lastName)) {
            return contactRepository.findFirstByContactTypeAndFirstNameIgnoreCaseAndLastNameIgnoreCaseAndOrganizationIdAndBranchIdAndStatus(
                    contactType,
                    firstName,
                    lastName,
                    organizationId,
                    branchId,
            com.nexoraa.billtop.enums.Status.ACTIVE);
        }
        return contactRepository.findFirstByContactTypeAndFirstNameIgnoreCaseAndOrganizationIdAndBranchIdAndStatus(
                contactType,
                firstName,
                organizationId,
                branchId,
        com.nexoraa.billtop.enums.Status.ACTIVE);
    }

    private Contact newContact(Organization organization, Branch branch) {
        Contact contact = new Contact();
        contact.setOrganization(organization);
        contact.setBranch(branch);
        contact.setStatus(com.nexoraa.billtop.enums.Status.ACTIVE);
        contact.setIsWholesale(false);
        return contact;
    }

    private void saveAddress(Contact contact, String addressText, String addressType, State state, Organization organization) {
        Address address = addressRepository.findByContactIdAndAddressTypeAndOrganizationId(
                        contact.getId(),
                        addressType,
                        organization.getId()
                )
                .orElseGet(Address::new);
        boolean created = address.getId() == null;
        address.setOrganization(organization);
        address.setContact(contact);
        address.setAddressType(addressType);
        address.setAddressLine1(limit(addressText, 250));
        address.setAddressLine2(null);
        address.setState(state);
        if (created) {
        }
        addressRepository.save(address);
    }

    private State findState(
            Row row,
            DataFormatter formatter,
            ContactExcelImportResponseDto response,
            int rowIndex,
            String contactName
    ) {
        String stateName = text(row, STATE_NAME, formatter);
        if (!StringUtils.hasText(stateName)) {
            return null;
        }
        Optional<State> state = stateRepository.findFirstByStateNameIgnoreCaseAndStatus(stateName, com.nexoraa.billtop.enums.Status.ACTIVE);
        if (state.isEmpty()) {
            addWarning(response, rowIndex, contactName, "State Name '" + stateName + "' was not found, so address state was not linked.");
        }
        return state.orElse(null);
    }

    private void warnUnsupportedColumns(
            Row row,
            DataFormatter formatter,
            ContactExcelImportResponseDto response,
            int rowIndex,
            String contactName
    ) {
        if (StringUtils.hasText(text(row, OPENING_DATE, formatter))) {
            addWarning(response, rowIndex, contactName, "Opening Date is not persisted because the contacts table has no opening date column.");
        }
    }

    private String normalizeContactType(String value) {
        if (!StringUtils.hasText(value)) {
            return null;
        }
        String normalized = value.trim().toLowerCase(Locale.ROOT);
        if ("customer".equals(normalized) || "cust".equals(normalized)) {
            return CUSTOMER;
        }
        if ("supplier".equals(normalized) || "sup".equals(normalized)) {
            return SUPPLIER;
        }
        return null;
    }

    private String normalizeOpeningBalanceType(String value) {
        if (!StringUtils.hasText(value)) {
            return null;
        }
        String normalized = value.trim().toLowerCase(Locale.ROOT).replace("_", " ");
        if ("to pay".equals(normalized) || "payable".equals(normalized)) {
            return PAYABLE;
        }
        if ("to receive".equals(normalized) || "receivable".equals(normalized)) {
            return RECEIVABLE;
        }
        return null;
    }

    private Boolean bool(
            Row row,
            int column,
            DataFormatter formatter,
            ContactExcelImportResponseDto response,
            int rowIndex,
            String contactName
    ) {
        String value = text(row, column, formatter);
        if (!StringUtils.hasText(value)) {
            return false;
        }
        String normalized = value.trim().toLowerCase(Locale.ROOT);
        if ("yes".equals(normalized) || "y".equals(normalized) || "true".equals(normalized) || "1".equals(normalized)) {
            return true;
        }
        if ("no".equals(normalized) || "n".equals(normalized) || "false".equals(normalized) || "0".equals(normalized)) {
            return false;
        }
        addError(response, rowIndex, contactName, "Is Wholesale Customer must be Yes or No");
        return false;
    }

    private String text(Row row, int column, DataFormatter formatter) {
        if (row == null) {
            return "";
        }
        Cell cell = row.getCell(column, Row.MissingCellPolicy.RETURN_BLANK_AS_NULL);
        if (cell == null) {
            return "";
        }
        return formatter.formatCellValue(cell).trim();
    }

    private BigDecimal number(
            Row row,
            int column,
            DataFormatter formatter,
            BigDecimal defaultValue,
            String columnName,
            ContactExcelImportResponseDto response,
            int rowIndex,
            String contactName
    ) {
        if (row == null) {
            return defaultValue;
        }
        Cell cell = row.getCell(column, Row.MissingCellPolicy.RETURN_BLANK_AS_NULL);
        if (cell == null) {
            return defaultValue;
        }
        try {
            if (cell.getCellType() == CellType.NUMERIC) {
                return BigDecimal.valueOf(cell.getNumericCellValue());
            }
            String value = formatter.formatCellValue(cell)
                    .trim()
                    .replace(",", "")
                    .replace("%", "");
            if (!StringUtils.hasText(value)) {
                return defaultValue;
            }
            return new BigDecimal(value);
        } catch (NumberFormatException ex) {
            addError(response, rowIndex, contactName, columnName + " must be a valid number");
            return defaultValue;
        }
    }

    private Sheet findContactSheet(Workbook workbook) {
        Sheet sheet = workbook.getSheet(CONTACT_SHEET);
        if (sheet != null) {
            return sheet;
        }
        sheet = workbook.getSheet("Contacts");
        if (sheet != null) {
            return sheet;
        }
        return workbook.getNumberOfSheets() == 0 ? null : workbook.getSheetAt(0);
    }

    private boolean hasRowError(ContactExcelImportResponseDto response, int rowIndex) {
        int rowNumber = rowIndex + 1;
        return response.getErrors().stream()
                .anyMatch(error -> CONTACT_SHEET.equals(error.getSheetName()) && rowNumber == error.getRowNumber());
    }

    private boolean isBlankRow(Row row, int columnCount, DataFormatter formatter) {
        if (row == null) {
            return true;
        }
        for (int column = 0; column < columnCount; column++) {
            if (StringUtils.hasText(text(row, column, formatter))) {
                return false;
            }
        }
        return true;
    }

    private void addError(ContactExcelImportResponseDto response, int rowIndex, String contactName, String message) {
        response.getErrors().add(message(rowIndex, contactName, message));
    }

    private void addWarning(ContactExcelImportResponseDto response, int rowIndex, String contactName, String message) {
        response.getWarnings().add(message(rowIndex, contactName, message));
    }

    private ContactExcelImportMessageDto message(int rowIndex, String contactName, String message) {
        return ContactExcelImportMessageDto.builder()
                .sheetName(CONTACT_SHEET)
                .rowNumber(rowIndex + 1)
                .contactName(contactName)
                .message(message)
                .build();
    }

    private String displayName(String firstName, String lastName) {
        return (safe(firstName) + " " + safe(lastName)).trim();
    }

    private String safe(String value) {
        return value == null ? "" : value.trim();
    }

    private String limit(String value, int maxLength) {
        if (!StringUtils.hasText(value)) {
            return null;
        }
        String trimmed = value.trim();
        return trimmed.length() <= maxLength ? trimmed : trimmed.substring(0, maxLength);
    }

    private String[] contactHeaders() {
        return new String[]{
                "Contact Type*",
                "First Name*",
                "Last Name",
                "Email",
                "Phone",
                "Mobile",
                "WhatsApp Number",
                "Tax Number",
                "State Name",
                "Billing Address",
                "Shipping Address",
                "Opening Balance",
                "Opening Date (dd-mm-yyyy)",
                "Opening Balance Type",
                "Credit Limit",
                "Is Wholesale Customer? (Yes/No)"
        };
    }

    private void createHeader(Sheet sheet, CellStyle style, String[] headers) {
        Row row = sheet.createRow(0);
        row.setHeightInPoints(72);
        for (int column = 0; column < headers.length; column++) {
            Cell cell = row.createCell(column);
            cell.setCellValue(headers[column]);
            cell.setCellStyle(style);
        }
        sheet.createFreezePane(0, 1);
        sheet.setAutoFilter(new CellRangeAddress(0, 0, 0, headers.length - 1));
    }

    private void addSampleRows(Sheet sheet, CellStyle textStyle, CellStyle numberStyle, CellStyle dateStyle) {
        Object[][] rows = {
                {"Customer", "Customer 1", "", "", "", "", "", "", "", "", "", 1000, LocalDate.of(2024, 7, 15), "To Pay", 10000, "No"},
                {"Customer", "Customer 2", "", "", "", "", "", "", "", "", "", 2000, LocalDate.of(2024, 7, 14), "To Receive", 20000, "Yes"},
                {"Customer", "Customer 3", "", "", "", "", "", "", "", "", "", 0, "", "", "", "No"},
                {"Supplier", "Supplier 1", "", "", "", "", "", "", "", "", "", 0, "", "", "", "Yes"},
                {"Supplier", "Supplier 2", "", "", "", "", "", "", "", "", "", 0, "", "", "", "Yes"},
                {"Supplier", "Supplier 3", "", "", "", "", "", "", "", "", "", 0, "", "", "", "Yes"}
        };

        for (int rowIndex = 0; rowIndex < rows.length; rowIndex++) {
            Row row = sheet.createRow(rowIndex + 1);
            for (int column = 0; column < rows[rowIndex].length; column++) {
                Cell cell = row.createCell(column);
                Object value = rows[rowIndex][column];
                if (value instanceof Number number) {
                    cell.setCellValue(number.doubleValue());
                    cell.setCellStyle(numberStyle);
                } else if (value instanceof LocalDate date) {
                    cell.setCellValue(date);
                    cell.setCellStyle(dateStyle);
                } else {
                    cell.setCellValue(value == null ? "" : String.valueOf(value));
                    cell.setCellStyle(textStyle);
                }
            }
        }
    }

    private void addListValidation(Sheet sheet, int column, String[] values) {
        DataValidationHelper helper = sheet.getDataValidationHelper();
        DataValidationConstraint constraint = helper.createExplicitListConstraint(values);
        CellRangeAddressList range = new CellRangeAddressList(1, 1000, column, column);
        DataValidation validation = helper.createValidation(constraint, range);
        validation.setSuppressDropDownArrow(true);
        validation.setShowErrorBox(true);
        sheet.addValidationData(validation);
    }

    private void sizeColumns(Sheet sheet, int columnCount) {
        for (int column = 0; column < columnCount; column++) {
            sheet.setColumnWidth(column, 18 * 256);
        }
        sheet.setColumnWidth(BILLING_ADDRESS, 26 * 256);
        sheet.setColumnWidth(SHIPPING_ADDRESS, 26 * 256);
        sheet.setColumnWidth(IS_WHOLESALE, 20 * 256);
    }

    private CellStyle headerStyle(Workbook workbook) {
        CellStyle style = workbook.createCellStyle();
        style.setFillForegroundColor(IndexedColors.LIGHT_BLUE.getIndex());
        style.setFillPattern(FillPatternType.SOLID_FOREGROUND);
        style.setAlignment(HorizontalAlignment.CENTER);
        style.setVerticalAlignment(VerticalAlignment.CENTER);
        style.setWrapText(true);
        style.setBorderBottom(BorderStyle.THIN);
        style.setBorderTop(BorderStyle.THIN);
        style.setBorderLeft(BorderStyle.THIN);
        style.setBorderRight(BorderStyle.THIN);
        Font font = workbook.createFont();
        font.setBold(true);
        font.setColor(IndexedColors.WHITE.getIndex());
        style.setFont(font);
        return style;
    }

    private CellStyle textStyle(Workbook workbook) {
        CellStyle style = workbook.createCellStyle();
        style.setVerticalAlignment(VerticalAlignment.CENTER);
        return style;
    }

    private CellStyle numberStyle(Workbook workbook) {
        CellStyle style = textStyle(workbook);
        DataFormat format = workbook.createDataFormat();
        style.setDataFormat(format.getFormat("0.##"));
        return style;
    }

    private CellStyle dateStyle(Workbook workbook) {
        CellStyle style = textStyle(workbook);
        DataFormat format = workbook.createDataFormat();
        style.setDataFormat(format.getFormat("dd-mm-yyyy"));
        return style;
    }
}





