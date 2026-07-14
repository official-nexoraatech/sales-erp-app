package com.nexoraa.billtop.service.impl;

import com.nexoraa.billtop.constants.ErrorMessage;
import com.nexoraa.billtop.dto.common.NameIdResponseDto;
import com.nexoraa.billtop.dto.purchase.PurchaseItemRequestDto;
import com.nexoraa.billtop.entity.Contact;
import com.nexoraa.billtop.entity.Item;
import com.nexoraa.billtop.entity.ItemBatch;
import com.nexoraa.billtop.entity.ItemPrice;
import com.nexoraa.billtop.entity.PaymentMethod;
import com.nexoraa.billtop.entity.ShippingCarrier;
import com.nexoraa.billtop.entity.State;
import com.nexoraa.billtop.entity.Stock;
import com.nexoraa.billtop.entity.StockTransaction;
import com.nexoraa.billtop.entity.User;
import com.nexoraa.billtop.entity.Warehouse;
import com.nexoraa.billtop.exception.BadRequestException;
import com.nexoraa.billtop.exception.ResourceNotFoundException;
import com.nexoraa.billtop.repository.ContactRepository;
import com.nexoraa.billtop.repository.ItemBatchRepository;
import com.nexoraa.billtop.repository.ItemPriceRepository;
import com.nexoraa.billtop.repository.ItemRepository;
import com.nexoraa.billtop.repository.PaymentMethodRepository;
import com.nexoraa.billtop.repository.ShippingCarrierRepository;
import com.nexoraa.billtop.repository.StateRepository;
import com.nexoraa.billtop.repository.StockRepository;
import com.nexoraa.billtop.repository.StockTransactionRepository;
import com.nexoraa.billtop.repository.UserRepository;
import com.nexoraa.billtop.repository.WarehouseRepository;
import com.nexoraa.billtop.security.CurrentOrganizationService;
import com.nexoraa.billtop.service.ItemStockStatusService;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDateTime;
import java.util.List;

@Component
class TransactionSupport {

    static final String CUSTOMER = "CUSTOMER";
    static final String SUPPLIER = "SUPPLIER";
    static final String STATUS_PENDING = "PENDING";
    static final String STATUS_CREATED = "CREATED";
    static final String STATUS_ACTIVE = "ACTIVE";
    static final String STATUS_PAID = "PAID";
    static final String STATUS_CANCELLED = "CANCELLED";
    static final BigDecimal ZERO = BigDecimal.ZERO;

    private static final BigDecimal HUNDRED = BigDecimal.valueOf(100);
    private static final String SYSTEM = "SYSTEM";

    private final ContactRepository contactRepository;
    private final WarehouseRepository warehouseRepository;
    private final ShippingCarrierRepository shippingCarrierRepository;
    private final StateRepository stateRepository;
    private final UserRepository userRepository;
    private final ItemRepository itemRepository;
    private final ItemBatchRepository itemBatchRepository;
    private final ItemPriceRepository itemPriceRepository;
    private final StockRepository stockRepository;
    private final StockTransactionRepository stockTransactionRepository;
    private final PaymentMethodRepository paymentMethodRepository;
    private final ItemStockStatusService itemStockStatusService;
    private final CurrentOrganizationService currentOrganizationService;

    TransactionSupport(
            ContactRepository contactRepository,
            WarehouseRepository warehouseRepository,
            ShippingCarrierRepository shippingCarrierRepository,
            StateRepository stateRepository,
            UserRepository userRepository,
            ItemRepository itemRepository,
            ItemBatchRepository itemBatchRepository,
            ItemPriceRepository itemPriceRepository,
            StockRepository stockRepository,
            StockTransactionRepository stockTransactionRepository,
            PaymentMethodRepository paymentMethodRepository,
            ItemStockStatusService itemStockStatusService,
            CurrentOrganizationService currentOrganizationService
    ) {
        this.contactRepository = contactRepository;
        this.warehouseRepository = warehouseRepository;
        this.shippingCarrierRepository = shippingCarrierRepository;
        this.stateRepository = stateRepository;
        this.userRepository = userRepository;
        this.itemRepository = itemRepository;
        this.itemBatchRepository = itemBatchRepository;
        this.itemPriceRepository = itemPriceRepository;
        this.stockRepository = stockRepository;
        this.stockTransactionRepository = stockTransactionRepository;
        this.paymentMethodRepository = paymentMethodRepository;
        this.itemStockStatusService = itemStockStatusService;
        this.currentOrganizationService = currentOrganizationService;
    }

    Contact getActiveSupplier(Long id) {
        return contactRepository.findByIdAndContactTypeAndOrganizationIdAndStatus(
                        id,
                        SUPPLIER,
                        currentOrganizationService.getOrganizationId(),
                com.nexoraa.billtop.enums.Status.ACTIVE)
                .orElseThrow(() -> new ResourceNotFoundException(ErrorMessage.SUPPLIER_NOT_FOUND, "SUPPLIER_NOT_FOUND"));
    }

    Contact getActiveCustomer(Long id) {
        return contactRepository.findByIdAndContactTypeAndOrganizationIdAndStatus(
                        id,
                        CUSTOMER,
                        currentOrganizationService.getOrganizationId(),
                com.nexoraa.billtop.enums.Status.ACTIVE)
                .orElseThrow(() -> new ResourceNotFoundException(ErrorMessage.CUSTOMER_NOT_FOUND, "CUSTOMER_NOT_FOUND"));
    }

    Warehouse getActiveWarehouse(Long id) {
        return warehouseRepository.findByIdAndOrganizationIdAndStatus(id, currentOrganizationService.getOrganizationId(), com.nexoraa.billtop.enums.Status.ACTIVE)
                .orElseThrow(() -> new ResourceNotFoundException(ErrorMessage.WAREHOUSE_NOT_FOUND, "WAREHOUSE_NOT_FOUND"));
    }

    ShippingCarrier getActiveCarrier(Long id) {
        if (id == null) {
            return null;
        }
        return shippingCarrierRepository.findByIdAndOrganizationIdAndStatusAndIsDeletedFalse(
                        id,
                        currentOrganizationService.getOrganizationId(),
                        com.nexoraa.billtop.enums.Status.ACTIVE
                )
                .orElseThrow(() -> new ResourceNotFoundException(
                        ErrorMessage.SHIPPING_CARRIER_NOT_FOUND,
                        "SHIPPING_CARRIER_NOT_FOUND"
                ));
    }

    State getActiveState(Long id) {
        if (id == null) {
            return null;
        }
        return stateRepository.findByIdAndStatus(id, com.nexoraa.billtop.enums.Status.ACTIVE)
                .orElseThrow(() -> new ResourceNotFoundException(ErrorMessage.STATE_NOT_FOUND, "STATE_NOT_FOUND"));
    }

    User getActiveUser(Long id) {
        if (id == null) {
            return null;
        }
        User user = userRepository.findByIdAndOrganizationId(id, currentOrganizationService.getOrganizationId())
                .orElseThrow(() -> new ResourceNotFoundException(ErrorMessage.USER_NOT_FOUND, "USER_NOT_FOUND"));
        if (!com.nexoraa.billtop.enums.Status.ACTIVE.equals(user.getStatus())) {
            throw new ResourceNotFoundException(ErrorMessage.USER_NOT_FOUND, "USER_NOT_FOUND");
        }
        return user;
    }

    Item getActiveItem(Long id) {
        return itemRepository.findByIdAndOrganizationIdAndIsDeletedFalse(id, currentOrganizationService.getOrganizationId())
                .orElseThrow(() -> new ResourceNotFoundException(ErrorMessage.ITEM_NOT_FOUND, "ITEM_NOT_FOUND"));
    }

    PaymentMethod getActivePaymentMethod(Long id) {
        return paymentMethodRepository.findByIdAndOrganizationIdAndStatusAndIsDeletedFalse(
                        id,
                        currentOrganizationService.getOrganizationId(),
                        com.nexoraa.billtop.enums.Status.ACTIVE
                )
                .orElseThrow(() -> new ResourceNotFoundException(
                        ErrorMessage.PAYMENT_METHOD_NOT_FOUND,
                        "PAYMENT_METHOD_NOT_FOUND"
                ));
    }

    ItemBatch getBatchForItem(Long batchId, Long itemId) {
        ItemBatch batch = itemBatchRepository.findByIdAndItemId(batchId, itemId)
                .orElseThrow(() -> new ResourceNotFoundException("Item batch not found", "ITEM_BATCH_NOT_FOUND"));
        return batch;
    }

    ItemBatch getOrCreateBatch(Item item, PurchaseItemRequestDto request) {
        validateBatchDates(request.getManufacturingDate(), request.getExpiryDate());
        return itemBatchRepository.findByItemIdAndBatchNo(
                        item.getId(),
                        request.getBatchNo()
                )
                .orElseGet(() -> itemBatchRepository.save(ItemBatch.builder()
                        .item(item)
                        .batchNo(request.getBatchNo())
                        .manufacturingDate(request.getManufacturingDate())
                        .expiryDate(request.getExpiryDate())
                        .build()));
    }

    BigDecimal getSalePrice(Item item) {
        ItemPrice price = itemPriceRepository.findTopByItemIdOrderByIdDesc(item.getId())
                .orElseThrow(() -> new BadRequestException("Sale price is not configured", "SALE_PRICE_NOT_CONFIGURED"));
        BigDecimal salePrice = defaultZero(price.getSalePrice());
        if (salePrice.compareTo(ZERO) <= 0) {
            throw new BadRequestException("Sale price is not configured", "SALE_PRICE_NOT_CONFIGURED");
        }
        return money(salePrice);
    }

    List<Stock> getStocksForItemAndWarehouse(Long itemId, Long warehouseId) {
        return stockRepository.findByItemIdAndWarehouseIdOrderByIdAsc(
                itemId,
                warehouseId
        );
    }

    Stock increaseStock(
            Item item,
            Warehouse warehouse,
            ItemBatch batch,
            BigDecimal quantity,
            String transactionType,
            Long referenceId,
            String remarks
    ) {
        Stock stock = stockRepository.findFirstByItemIdAndWarehouseIdAndBatchId(
                item.getId(),
                warehouse.getId(),
                batch.getId()
        ).orElseGet(() -> Stock.builder()
                .item(item)
                .warehouse(warehouse)
                .batch(batch)
                .availableQty(ZERO)
                .reservedQty(ZERO)
                .minimumStock(ZERO)
                .reorderLevel(ZERO)
                .build());

        stock.setAvailableQty(quantity(defaultZero(stock.getAvailableQty()).add(quantity)));
        stock.setReservedQty(quantity(defaultZero(stock.getReservedQty())));
        Stock savedStock = stockRepository.save(stock);
        itemStockStatusService.refreshStatus(item);
        createStockTransaction(item, warehouse, batch, transactionType, referenceId, quantity, ZERO, savedStock.getAvailableQty(), remarks);
        return savedStock;
    }

    Stock decreaseStock(
            Item item,
            Warehouse warehouse,
            ItemBatch batch,
            BigDecimal quantity,
            String transactionType,
            Long referenceId,
            String remarks
    ) {
        Stock stock = stockRepository.findFirstByItemIdAndWarehouseIdAndBatchId(
                item.getId(),
                warehouse.getId(),
                batch.getId()
        ).orElseThrow(() -> new BadRequestException(ErrorMessage.INSUFFICIENT_STOCK, "INSUFFICIENT_STOCK"));

        BigDecimal availableQty = defaultZero(stock.getAvailableQty());
        if (availableQty.compareTo(quantity) < 0) {
            throw new BadRequestException(ErrorMessage.INSUFFICIENT_STOCK, "INSUFFICIENT_STOCK");
        }

        stock.setAvailableQty(quantity(availableQty.subtract(quantity)));
        stock.setReservedQty(quantity(defaultZero(stock.getReservedQty())));
        Stock savedStock = stockRepository.save(stock);
        itemStockStatusService.refreshStatus(item);
        createStockTransaction(item, warehouse, batch, transactionType, referenceId, ZERO, quantity, savedStock.getAvailableQty(), remarks);
        return savedStock;
    }

    LineTotals calculateLine(BigDecimal quantity, BigDecimal unitPrice, BigDecimal discountPercent, BigDecimal taxPercent) {
        BigDecimal grossAmount = money(quantity.multiply(unitPrice));
        BigDecimal discountAmount = percentAmount(grossAmount, discountPercent);
        BigDecimal taxableAmount = grossAmount.subtract(discountAmount);
        BigDecimal taxAmount = percentAmount(taxableAmount, taxPercent);
        BigDecimal totalAmount = money(taxableAmount.add(taxAmount));
        return new LineTotals(grossAmount, discountAmount, taxAmount, totalAmount);
    }

    BigDecimal amount(BigDecimal quantity, BigDecimal rate) {
        return money(quantity.multiply(rate));
    }

    String nextNumber(String prefix, String currentNumber) {
        long current = 0;
        if (StringUtils.hasText(currentNumber) && currentNumber.startsWith(prefix)) {
            try {
                current = Long.parseLong(currentNumber.substring(prefix.length()));
            } catch (NumberFormatException ignored) {
                current = 0;
            }
        }
        return prefix + String.format("%06d", current + 1);
    }

    NameIdResponseDto toNameId(Contact contact) {
        if (contact == null) {
            return null;
        }
        return NameIdResponseDto.builder()
                .id(contact.getId())
                .name(contactDisplayName(contact))
                .build();
    }

    NameIdResponseDto toNameId(Warehouse warehouse) {
        if (warehouse == null) {
            return null;
        }
        return NameIdResponseDto.builder()
                .id(warehouse.getId())
                .name(warehouse.getName())
                .build();
    }

    String contactDisplayName(Contact contact) {
        if (contact == null) {
            return null;
        }
        String firstName = StringUtils.hasText(contact.getFirstName()) ? contact.getFirstName().trim() : "";
        String lastName = StringUtils.hasText(contact.getLastName()) ? contact.getLastName().trim() : "";
        String fullName = (firstName + " " + lastName).trim();
        return StringUtils.hasText(fullName) ? fullName : "Contact #" + contact.getId();
    }

    BigDecimal money(BigDecimal value) {
        return defaultZero(value).setScale(2, RoundingMode.HALF_UP);
    }

    BigDecimal quantity(BigDecimal value) {
        return defaultZero(value).setScale(3, RoundingMode.HALF_UP);
    }

    BigDecimal defaultZero(BigDecimal value) {
        return value == null ? ZERO : value;
    }

    boolean isCancelled(String status) {
        return STATUS_CANCELLED.equalsIgnoreCase(status);
    }

    void validateBatchDates(java.time.LocalDate manufacturingDate, java.time.LocalDate expiryDate) {
        if (manufacturingDate != null && expiryDate != null && expiryDate.isBefore(manufacturingDate)) {
            throw new BadRequestException(ErrorMessage.INVALID_EXPIRY_DATE, "INVALID_EXPIRY_DATE");
        }
    }

    private BigDecimal percentAmount(BigDecimal amount, BigDecimal percent) {
        return money(amount.multiply(defaultZero(percent)).divide(HUNDRED, 6, RoundingMode.HALF_UP));
    }

    private void createStockTransaction(
            Item item,
            Warehouse warehouse,
            ItemBatch batch,
            String transactionType,
            Long referenceId,
            BigDecimal qtyIn,
            BigDecimal qtyOut,
            BigDecimal balanceQty,
            String remarks
    ) {
        stockTransactionRepository.save(StockTransaction.builder()
                .organization(item.getOrganization())
                .item(item)
                .warehouse(warehouse)
                .batch(batch)
                .transactionType(transactionType)
                .referenceId(referenceId)
                .qtyIn(quantity(qtyIn))
                .qtyOut(quantity(qtyOut))
                .balanceQty(quantity(balanceQty))
                .transactionDate(LocalDateTime.now())
                .remarks(remarks)
                .build());
    }

    record LineTotals(BigDecimal grossAmount, BigDecimal discountAmount, BigDecimal taxAmount, BigDecimal totalAmount) {
    }
}
