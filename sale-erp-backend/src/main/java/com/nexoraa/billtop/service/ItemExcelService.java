package com.nexoraa.billtop.service;

import com.nexoraa.billtop.dto.item.excel.ItemExcelImportMessageDto;
import com.nexoraa.billtop.dto.item.excel.ItemExcelImportResponseDto;
import com.nexoraa.billtop.entity.Brand;
import com.nexoraa.billtop.entity.Category;
import com.nexoraa.billtop.entity.Item;
import com.nexoraa.billtop.entity.ItemBatch;
import com.nexoraa.billtop.entity.ItemPrice;
import com.nexoraa.billtop.entity.Organization;
import com.nexoraa.billtop.entity.Stock;
import com.nexoraa.billtop.entity.Unit;
import com.nexoraa.billtop.entity.Warehouse;
import com.nexoraa.billtop.exception.BadRequestException;
import com.nexoraa.billtop.exception.ResourceNotFoundException;
import com.nexoraa.billtop.repository.BrandRepository;
import com.nexoraa.billtop.repository.CategoryRepository;
import com.nexoraa.billtop.repository.ItemBatchRepository;
import com.nexoraa.billtop.repository.ItemPriceRepository;
import com.nexoraa.billtop.repository.ItemRepository;
import com.nexoraa.billtop.repository.StockRepository;
import com.nexoraa.billtop.repository.UnitRepository;
import com.nexoraa.billtop.repository.WarehouseRepository;
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
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

@Service
public class ItemExcelService {

    public static final String TEMPLATE_FILE_NAME = "Items-Import-Format.xlsx";
    private static final String ITEM_SHEET = "Item Details";
    private static final String BATCH_SHEET = "Batch Details";
    private static final String DEFAULT_CATEGORY = "General";
    private static final String DEFAULT_BRAND = "General";
    private static final BigDecimal ZERO = BigDecimal.ZERO;

    private static final int ITEM_NAME = 0;
    private static final int ITEM_DESCRIPTION = 1;
    private static final int ITEM_TYPE = 2;
    private static final int ITEM_HSN = 3;
    private static final int ITEM_SKU = 4;
    private static final int ITEM_CODE = 5;
    private static final int ITEM_CATEGORY = 6;
    private static final int ITEM_BRAND = 7;
    private static final int ITEM_MRP = 8;
    private static final int ITEM_MSP = 9;
    private static final int ITEM_PURCHASE_PRICE = 10;
    private static final int ITEM_TAX_RATE = 11;
    private static final int ITEM_TAX_NAME = 12;
    private static final int ITEM_TAX_TYPE = 13;
    private static final int ITEM_PROFIT_MARGIN = 14;
    private static final int ITEM_SALE_PRICE = 15;
    private static final int ITEM_DISCOUNT = 16;

    private static final int BATCH_ITEM_NAME = 0;
    private static final int BATCH_NUMBER = 1;
    private static final int BATCH_MANUFACTURE_DATE = 2;
    private static final int BATCH_EXPIRY_DATE = 3;
    private static final int BATCH_MODEL = 4;
    private static final int BATCH_MRP = 5;
    private static final int BATCH_COLOR = 6;
    private static final int BATCH_SIZE = 7;
    private static final int BATCH_OPENING_QTY = 8;

    private final ItemRepository itemRepository;
    private final CategoryRepository categoryRepository;
    private final BrandRepository brandRepository;
    private final UnitRepository unitRepository;
    private final WarehouseRepository warehouseRepository;
    private final ItemPriceRepository itemPriceRepository;
    private final ItemBatchRepository itemBatchRepository;
    private final StockRepository stockRepository;
    private final CurrentOrganizationService currentOrganizationService;

    public ItemExcelService(
            ItemRepository itemRepository,
            CategoryRepository categoryRepository,
            BrandRepository brandRepository,
            UnitRepository unitRepository,
            WarehouseRepository warehouseRepository,
            ItemPriceRepository itemPriceRepository,
            ItemBatchRepository itemBatchRepository,
            StockRepository stockRepository,
            CurrentOrganizationService currentOrganizationService
    ) {
        this.itemRepository = itemRepository;
        this.categoryRepository = categoryRepository;
        this.brandRepository = brandRepository;
        this.unitRepository = unitRepository;
        this.warehouseRepository = warehouseRepository;
        this.itemPriceRepository = itemPriceRepository;
        this.itemBatchRepository = itemBatchRepository;
        this.stockRepository = stockRepository;
        this.currentOrganizationService = currentOrganizationService;
    }

    public byte[] generateTemplate() {
        try (Workbook workbook = new XSSFWorkbook(); ByteArrayOutputStream outputStream = new ByteArrayOutputStream()) {
            CellStyle headerStyle = headerStyle(workbook);
            CellStyle textStyle = textStyle(workbook);
            CellStyle numberStyle = numberStyle(workbook);
            CellStyle dateStyle = dateStyle(workbook);

            Sheet itemSheet = workbook.createSheet(ITEM_SHEET);
            createHeader(itemSheet, headerStyle, itemHeaders());
            addItemSampleRows(itemSheet, textStyle, numberStyle);
            addListValidation(itemSheet, ITEM_TYPE, new String[]{"Product", "Service"});
            addListValidation(itemSheet, ITEM_TAX_NAME, new String[]{"None", "Tax 12%", "Tax 18%", "Tax 28%"});
            addListValidation(itemSheet, ITEM_TAX_TYPE, new String[]{"Inclusive", "Exclusive"});
            sizeColumns(itemSheet, itemHeaders().length);

            Sheet batchSheet = workbook.createSheet(BATCH_SHEET);
            createHeader(batchSheet, headerStyle, batchHeaders());
            addBatchSampleRows(batchSheet, textStyle, numberStyle, dateStyle);
            sizeColumns(batchSheet, batchHeaders().length);

            workbook.write(outputStream);
            return outputStream.toByteArray();
        } catch (IOException ex) {
            throw new BadRequestException("Unable to generate item import template", "ITEM_EXCEL_TEMPLATE_FAILED");
        }
    }

    @Transactional
    public ItemExcelImportResponseDto importItems(MultipartFile file, Long warehouseId, Long baseUnitId) {
        if (file == null || file.isEmpty()) {
            throw new BadRequestException("Excel file is required", "EXCEL_FILE_REQUIRED");
        }

        Long organizationId = currentOrganizationService.getOrganizationId();
        Organization organization = currentOrganizationService.getOrganizationReference();
        Warehouse warehouse = warehouseRepository.findByIdAndOrganizationIdAndStatus(warehouseId, organizationId, com.nexoraa.billtop.enums.Status.ACTIVE)
                .orElseThrow(() -> new ResourceNotFoundException("Warehouse not found", "WAREHOUSE_NOT_FOUND"));
        Unit unit = unitRepository.findByIdAndOrganizationIdAndStatusAndIsDeletedFalse(baseUnitId, organizationId, com.nexoraa.billtop.enums.Status.ACTIVE)
                .orElseThrow(() -> new ResourceNotFoundException("Unit not found", "UNIT_NOT_FOUND"));

        ItemExcelImportResponseDto response = ItemExcelImportResponseDto.builder().build();
        Map<String, Item> importedItemsByName = new HashMap<>();
        DataFormatter formatter = new DataFormatter();

        try (InputStream inputStream = file.getInputStream(); Workbook workbook = WorkbookFactory.create(inputStream)) {
            Sheet itemSheet = workbook.getSheet(ITEM_SHEET);
            Sheet batchSheet = workbook.getSheet(BATCH_SHEET);
            if (itemSheet == null || batchSheet == null) {
                throw new BadRequestException("Workbook must contain 'Item Details' and 'Batch Details' sheets", "INVALID_ITEM_EXCEL_FORMAT");
            }

            importItemRows(itemSheet, formatter, organizationId, organization, unit, response, importedItemsByName);
            importBatchRows(batchSheet, formatter, organizationId, organization, warehouse, response, importedItemsByName);
            response.setFailedRows(response.getErrors().size());
            return response;
        } catch (IOException ex) {
            throw new BadRequestException("Unable to read Excel file", "ITEM_EXCEL_IMPORT_FAILED");
        }
    }

    private void importItemRows(
            Sheet sheet,
            DataFormatter formatter,
            Long organizationId,
            Organization organization,
            Unit unit,
            ItemExcelImportResponseDto response,
            Map<String, Item> importedItemsByName
    ) {
        for (int rowIndex = 1; rowIndex <= sheet.getLastRowNum(); rowIndex++) {
            Row row = sheet.getRow(rowIndex);
            if (isBlankRow(row, itemHeaders().length, formatter)) {
                continue;
            }
            response.setItemRows(response.getItemRows() + 1);

            String itemName = text(row, ITEM_NAME, formatter);
            String itemCode = text(row, ITEM_CODE, formatter);
            if (!StringUtils.hasText(itemName)) {
                addError(response, ITEM_SHEET, rowIndex, itemName, "Item Name is required");
                continue;
            }
            if (!StringUtils.hasText(itemCode)) {
                addError(response, ITEM_SHEET, rowIndex, itemName, "Item Code/Barcode is required");
                continue;
            }

            warnUnsupportedItemColumns(row, formatter, response, rowIndex, itemName);

            Category category = findOrCreateCategory(text(row, ITEM_CATEGORY, formatter), organizationId, organization);
            Brand brand = findOrCreateBrand(text(row, ITEM_BRAND, formatter), organizationId, category);
            Item item = itemRepository.findByItemCodeIgnoreCaseAndOrganizationIdAndStatus(itemCode, organizationId, com.nexoraa.billtop.enums.Status.ACTIVE)
                    .orElseGet(() -> newItem(organization));
            boolean created = item.getId() == null;

            item.setItemName(limit(itemName, 150));
            item.setItemCode(limit(itemCode, 50));
            item.setBarcode(limit(itemCode, 80));
            item.setSku(limit(text(row, ITEM_SKU, formatter), 80));
            item.setHsnCode(limit(text(row, ITEM_HSN, formatter), 30));
            item.setDescription(limit(text(row, ITEM_DESCRIPTION, formatter), 500));
            item.setCategory(category);
            item.setBrand(brand);
            item.setBaseUnit(unit);
            item.setConversionRate(BigDecimal.ONE);

            Item savedItem = itemRepository.save(item);
            saveItemPrice(savedItem, row, formatter, organizationId, organization);
            importedItemsByName.put(normalize(itemName), savedItem);

            if (created) {
                response.setCreatedItems(response.getCreatedItems() + 1);
            } else {
                response.setUpdatedItems(response.getUpdatedItems() + 1);
            }
        }
    }

    private void importBatchRows(
            Sheet sheet,
            DataFormatter formatter,
            Long organizationId,
            Organization organization,
            Warehouse warehouse,
            ItemExcelImportResponseDto response,
            Map<String, Item> importedItemsByName
    ) {
        for (int rowIndex = 1; rowIndex <= sheet.getLastRowNum(); rowIndex++) {
            Row row = sheet.getRow(rowIndex);
            if (isBlankRow(row, batchHeaders().length, formatter)) {
                continue;
            }
            response.setBatchRows(response.getBatchRows() + 1);

            String itemName = text(row, BATCH_ITEM_NAME, formatter);
            if (!StringUtils.hasText(itemName)) {
                addError(response, BATCH_SHEET, rowIndex, itemName, "Item Name is required");
                continue;
            }

            Item item = importedItemsByName.get(normalize(itemName));
            if (item == null) {
                item = itemRepository.findFirstByItemNameIgnoreCaseAndOrganizationIdAndStatus(itemName, organizationId, com.nexoraa.billtop.enums.Status.ACTIVE).orElse(null);
            }
            if (item == null) {
                addError(response, BATCH_SHEET, rowIndex, itemName, "Item not found. Add this item to the Item Details sheet first.");
                continue;
            }

            warnUnsupportedBatchColumns(row, formatter, response, rowIndex, itemName);

            String batchNo = text(row, BATCH_NUMBER, formatter);
            if (!StringUtils.hasText(batchNo)) {
                batchNo = "DEFAULT-" + item.getId();
                addWarning(response, BATCH_SHEET, rowIndex, itemName, "Batch Number is blank. Generated " + batchNo + ".");
            }

            LocalDate manufacturingDate = parseDate(row, BATCH_MANUFACTURE_DATE, formatter, response, rowIndex, itemName);
            LocalDate expiryDate = parseDate(row, BATCH_EXPIRY_DATE, formatter, response, rowIndex, itemName);
            if (hasRowError(response, BATCH_SHEET, rowIndex)) {
                continue;
            }

            BigDecimal openingQty = number(row, BATCH_OPENING_QTY, formatter, ZERO);
            if (openingQty.compareTo(ZERO) < 0) {
                addError(response, BATCH_SHEET, rowIndex, itemName, "Opening Quantity cannot be negative");
                continue;
            }

            Item batchItem = item;
            ItemBatch batch = itemBatchRepository.findByItemIdAndBatchNoAndOrganizationId(batchItem.getId(), batchNo, organizationId)
                    .orElseGet(() -> newBatch(organization, batchItem));
            boolean createdBatch = batch.getId() == null;
            batch.setBatchNo(limit(batchNo, 80));
            batch.setManufacturingDate(manufacturingDate);
            batch.setExpiryDate(expiryDate);
            ItemBatch savedBatch = itemBatchRepository.save(batch);

            ItemBatch stockBatch = savedBatch;
            Stock stock = stockRepository.findFirstByItemIdAndWarehouseIdAndBatchIdAndOrganizationId(
                            batchItem.getId(),
                            warehouse.getId(),
                            stockBatch.getId(),
                            organizationId
                    )
                    .orElseGet(() -> newStock(organization, batchItem, warehouse, stockBatch));
            stock.setAvailableQty(openingQty);
            stock.setReservedQty(stock.getReservedQty() == null ? ZERO : stock.getReservedQty());
            stock.setMinimumStock(stock.getMinimumStock() == null ? ZERO : stock.getMinimumStock());
            stock.setReorderLevel(stock.getReorderLevel() == null ? ZERO : stock.getReorderLevel());
            stockRepository.save(stock);

            if (createdBatch) {
                response.setCreatedBatches(response.getCreatedBatches() + 1);
            } else {
                response.setUpdatedBatches(response.getUpdatedBatches() + 1);
            }
            response.setStockRowsUpdated(response.getStockRowsUpdated() + 1);
        }
    }

    private void saveItemPrice(Item item, Row row, DataFormatter formatter, Long organizationId, Organization organization) {
        ItemPrice price = itemPriceRepository.findTopByItemIdAndOrganizationIdOrderByIdDesc(item.getId(), organizationId)
                .orElseGet(ItemPrice::new);
        price.setOrganization(organization);
        price.setItem(item);
        price.setPurchasePrice(number(row, ITEM_PURCHASE_PRICE, formatter, ZERO));
        price.setPurchasePriceWithTax(price.getPurchasePrice());
        price.setTaxPercentage(number(row, ITEM_TAX_RATE, formatter, ZERO));
        price.setSalePrice(number(row, ITEM_SALE_PRICE, formatter, number(row, ITEM_MRP, formatter, ZERO)));
        price.setMrp(number(row, ITEM_MRP, formatter, ZERO));
        price.setMsp(number(row, ITEM_MSP, formatter, ZERO));
        price.setWholesalePrice(ZERO);
        price.setDiscountPercentage(number(row, ITEM_DISCOUNT, formatter, ZERO));
        price.setProfitMargin(number(row, ITEM_PROFIT_MARGIN, formatter, ZERO));
        if (price.getEffectiveFrom() == null) {
            price.setEffectiveFrom(LocalDate.now());
        }
        itemPriceRepository.save(price);
    }

    private Category findOrCreateCategory(String categoryName, Long organizationId, Organization organization) {
        String name = StringUtils.hasText(categoryName) ? categoryName.trim() : DEFAULT_CATEGORY;
        return categoryRepository.findByNameIgnoreCaseAndOrganizationIdAndStatusAndIsDeletedFalse(
                        name,
                        organizationId,
                        com.nexoraa.billtop.enums.Status.ACTIVE
                )
                .orElseGet(() -> categoryRepository.save(Category.builder()
                        .organization(organization)
                        .name(limit(name, 100))
                        .description("Created by item Excel import")
                        .status(com.nexoraa.billtop.enums.Status.ACTIVE)
                        .build()));
    }

    private Brand findOrCreateBrand(
            String brandName,
            Long organizationId,
            Category category
    ) {
        String name = StringUtils.hasText(brandName) ? brandName.trim() : DEFAULT_BRAND;
        return brandRepository.findByNameIgnoreCaseAndCategory_IdAndStatusAndIsDeletedFalse(
                        name,
                        category.getId(),
                        com.nexoraa.billtop.enums.Status.ACTIVE
                )
                .orElseGet(() -> brandRepository.save(Brand.builder()
                        .category(category)
                        .name(limit(name, 100))
                        .description("Created by item Excel import")
                        .status(com.nexoraa.billtop.enums.Status.ACTIVE)
                        .build()));
    }

    private Item newItem(Organization organization) {
        Item item = new Item();
        item.setOrganization(organization);
        item.setStatus(com.nexoraa.billtop.enums.Status.ACTIVE);
        return item;
    }

    private ItemBatch newBatch(Organization organization, Item item) {
        return ItemBatch.builder()
                .organization(organization)
                .item(item)
                .build();
    }

    private Stock newStock(Organization organization, Item item, Warehouse warehouse, ItemBatch batch) {
        return Stock.builder()
                .organization(organization)
                .item(item)
                .warehouse(warehouse)
                .batch(batch)
                .reservedQty(ZERO)
                .minimumStock(ZERO)
                .reorderLevel(ZERO)
                .build();
    }

    private void warnUnsupportedItemColumns(
            Row row,
            DataFormatter formatter,
            ItemExcelImportResponseDto response,
            int rowIndex,
            String itemName
    ) {
        if (StringUtils.hasText(text(row, ITEM_TYPE, formatter))) {
            addWarning(response, ITEM_SHEET, rowIndex, itemName, "Item Type is not persisted because the current item table has no item_type column.");
        }
        if (StringUtils.hasText(text(row, ITEM_TAX_NAME, formatter))) {
            addWarning(response, ITEM_SHEET, rowIndex, itemName, "Tax Name is not persisted separately. Tax Rate is saved as taxPercentage.");
        }
        if (StringUtils.hasText(text(row, ITEM_TAX_TYPE, formatter))) {
            addWarning(response, ITEM_SHEET, rowIndex, itemName, "Tax Type is not persisted because the current item price table has no tax_type column.");
        }
    }

    private void warnUnsupportedBatchColumns(
            Row row,
            DataFormatter formatter,
            ItemExcelImportResponseDto response,
            int rowIndex,
            String itemName
    ) {
        if (StringUtils.hasText(text(row, BATCH_MODEL, formatter))) {
            addWarning(response, BATCH_SHEET, rowIndex, itemName, "Model is not persisted because the current batch table has no model column.");
        }
        if (StringUtils.hasText(text(row, BATCH_MRP, formatter))) {
            addWarning(response, BATCH_SHEET, rowIndex, itemName, "Batch MRP is not persisted separately. Item-level MRP is read from the Item Details sheet.");
        }
        if (StringUtils.hasText(text(row, BATCH_COLOR, formatter))) {
            addWarning(response, BATCH_SHEET, rowIndex, itemName, "Color is not persisted because the current batch table has no color column.");
        }
        if (StringUtils.hasText(text(row, BATCH_SIZE, formatter))) {
            addWarning(response, BATCH_SHEET, rowIndex, itemName, "Size is not persisted because the current batch table has no size column.");
        }
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

    private BigDecimal number(Row row, int column, DataFormatter formatter, BigDecimal defaultValue) {
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
            String value = formatter.formatCellValue(cell).trim().replace("%", "");
            if (!StringUtils.hasText(value)) {
                return defaultValue;
            }
            return new BigDecimal(value);
        } catch (NumberFormatException ex) {
            return defaultValue;
        }
    }

    private LocalDate parseDate(
            Row row,
            int column,
            DataFormatter formatter,
            ItemExcelImportResponseDto response,
            int rowIndex,
            String itemName
    ) {
        Cell cell = row.getCell(column, Row.MissingCellPolicy.RETURN_BLANK_AS_NULL);
        if (cell == null) {
            return null;
        }
        if (cell.getCellType() == CellType.NUMERIC && DateUtil.isCellDateFormatted(cell)) {
            return cell.getLocalDateTimeCellValue().toLocalDate();
        }
        String value = formatter.formatCellValue(cell).trim();
        if (!StringUtils.hasText(value)) {
            return null;
        }
        try {
            return LocalDate.parse(value, DateTimeFormatter.ISO_LOCAL_DATE);
        } catch (DateTimeParseException ex) {
            addError(response, BATCH_SHEET, rowIndex, itemName, "Invalid date '" + value + "'. Use yyyy-MM-dd.");
            return null;
        }
    }

    private boolean hasRowError(ItemExcelImportResponseDto response, String sheetName, int rowIndex) {
        int rowNumber = rowIndex + 1;
        return response.getErrors().stream()
                .anyMatch(error -> sheetName.equals(error.getSheetName()) && rowNumber == error.getRowNumber());
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

    private void addError(ItemExcelImportResponseDto response, String sheetName, int rowIndex, String itemName, String message) {
        response.getErrors().add(message(sheetName, rowIndex, itemName, message));
    }

    private void addWarning(ItemExcelImportResponseDto response, String sheetName, int rowIndex, String itemName, String message) {
        response.getWarnings().add(message(sheetName, rowIndex, itemName, message));
    }

    private ItemExcelImportMessageDto message(String sheetName, int rowIndex, String itemName, String message) {
        return ItemExcelImportMessageDto.builder()
                .sheetName(sheetName)
                .rowNumber(rowIndex + 1)
                .itemName(itemName)
                .message(message)
                .build();
    }

    private String normalize(String value) {
        return value == null ? "" : value.trim().toLowerCase(Locale.ROOT);
    }

    private String limit(String value, int maxLength) {
        if (!StringUtils.hasText(value)) {
            return null;
        }
        String trimmed = value.trim();
        return trimmed.length() <= maxLength ? trimmed : trimmed.substring(0, maxLength);
    }

    private String[] itemHeaders() {
        return new String[]{
                "Item Name*",
                "Description",
                "Item Type*",
                "HSN",
                "SKU",
                "Item Code/Barcode*",
                "Category",
                "Brand Name",
                "MRP (Maximum Retail Price)",
                "MSP (Minimum Selling Price)",
                "Purchase Price",
                "Tax Rate*",
                "Tax Name*",
                "Tax Type*",
                "Sale Profit Margin in %",
                "Sale Price",
                "Discount on Sale"
        };
    }

    private String[] batchHeaders() {
        return new String[]{
                "Item Name*",
                "Batch Number*",
                "Manufacture Date (yyyy-mm-dd)",
                "Expiry Date (yyyy-mm-dd)",
                "Model",
                "MRP",
                "Color",
                "Size",
                "Opening Quantity"
        };
    }

    private void createHeader(Sheet sheet, CellStyle style, String[] headers) {
        Row row = sheet.createRow(0);
        row.setHeightInPoints(54);
        for (int column = 0; column < headers.length; column++) {
            Cell cell = row.createCell(column);
            cell.setCellValue(headers[column]);
            cell.setCellStyle(style);
        }
        sheet.createFreezePane(0, 1);
        sheet.setAutoFilter(new CellRangeAddress(0, 0, 0, headers.length - 1));
    }

    private void addItemSampleRows(Sheet sheet, CellStyle textStyle, CellStyle numberStyle) {
        Object[][] rows = {
                {"Item 11", "", "Product", "", "", "1001", "", "", 500, 400, 400, 12, "Tax 12%", "Inclusive", "", 500, 10},
                {"Item 2", "", "Product", "", "", "1002", "", "", 600, 500, 500, 18, "Tax 18%", "Exclusive", "", 600, 10},
                {"Item 3", "", "Service", "", "", "1003", "", "", 1000, 800, 0, 18, "Tax 18%", "Inclusive", "", 1000, 100},
                {"Item 4", "", "Product", "", "", "1004", "", "", 1200, 900, 1000, 28, "Tax 28%", "Exclusive", "", 1200, 15},
                {"Item 5", "", "Service", "", "", "1005", "", "", 800, 600, 0, 18, "Tax 18%", "Inclusive", "", 800, 10},
                {"Item 6", "", "Product", "", "", "2001", "", "", "", "", "", 0, "None", "Inclusive", "", "", ""},
                {"Item 7", "", "Service", "", "", "2002", "", "", "", "", "", 0, "None", "Inclusive", "", "", ""}
        };
        addRows(sheet, rows, textStyle, numberStyle, null);
    }

    private void addBatchSampleRows(Sheet sheet, CellStyle textStyle, CellStyle numberStyle, CellStyle dateStyle) {
        Object[][] rows = {
                {"Item 2", "B1", LocalDate.of(2023, 10, 14), LocalDate.of(2024, 10, 14), "", "", "", "", 50},
                {"Item 2", "B2", LocalDate.of(2023, 8, 14), LocalDate.of(2024, 8, 14), "", "", "", "", 50},
                {"Item 2", "B3", LocalDate.of(2023, 8, 20), LocalDate.of(2024, 8, 20), "", "", "", "", 40},
                {"Item 4", "", "", "", "", "", "", "Small", 60}
        };
        addRows(sheet, rows, textStyle, numberStyle, dateStyle);
    }

    private void addRows(Sheet sheet, Object[][] rows, CellStyle textStyle, CellStyle numberStyle, CellStyle dateStyle) {
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
        style.setDataFormat(format.getFormat("yyyy-mm-dd"));
        return style;
    }
}





