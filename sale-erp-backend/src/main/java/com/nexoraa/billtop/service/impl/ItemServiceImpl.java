package com.nexoraa.billtop.service.impl;

import com.nexoraa.billtop.constants.ErrorMessage;
import com.nexoraa.billtop.dto.PageResponseDto;
import com.nexoraa.billtop.dto.item.ItemCreateResponseDto;
import com.nexoraa.billtop.dto.item.ItemDetailResponseDto;
import com.nexoraa.billtop.dto.item.ItemListResponseDto;
import com.nexoraa.billtop.dto.item.ItemRequestDto;
import com.nexoraa.billtop.dto.item.ItemStockResponseDto;
import com.nexoraa.billtop.entity.Brand;
import com.nexoraa.billtop.entity.Category;
import com.nexoraa.billtop.entity.Item;
import com.nexoraa.billtop.entity.ItemBatch;
import com.nexoraa.billtop.entity.ItemPrice;
import com.nexoraa.billtop.entity.Organization;
import com.nexoraa.billtop.entity.Stock;
import com.nexoraa.billtop.entity.SubCategory;
import com.nexoraa.billtop.entity.Unit;
import com.nexoraa.billtop.entity.Warehouse;
import com.nexoraa.billtop.enums.ItemStatus;
import com.nexoraa.billtop.exception.BadRequestException;
import com.nexoraa.billtop.exception.ResourceNotFoundException;
import com.nexoraa.billtop.mapper.ItemMapper;
import com.nexoraa.billtop.repository.BrandRepository;
import com.nexoraa.billtop.repository.CategoryRepository;
import com.nexoraa.billtop.repository.ItemBatchRepository;
import com.nexoraa.billtop.repository.ItemPriceRepository;
import com.nexoraa.billtop.repository.ItemRepository;
import com.nexoraa.billtop.repository.StockRepository;
import com.nexoraa.billtop.repository.SubCategoryRepository;
import com.nexoraa.billtop.repository.UnitRepository;
import com.nexoraa.billtop.repository.WarehouseRepository;
import com.nexoraa.billtop.security.CurrentOrganizationService;
import com.nexoraa.billtop.service.ItemStockStatusService;
import com.nexoraa.billtop.service.ItemService;
import com.nexoraa.billtop.specification.ItemSpecification;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;

@Service
public class ItemServiceImpl implements ItemService {

    private static final BigDecimal ZERO = BigDecimal.ZERO;

    private final ItemRepository itemRepository;
    private final CategoryRepository categoryRepository;
    private final SubCategoryRepository subCategoryRepository;
    private final BrandRepository brandRepository;
    private final UnitRepository unitRepository;
    private final WarehouseRepository warehouseRepository;
    private final ItemPriceRepository itemPriceRepository;
    private final ItemBatchRepository itemBatchRepository;
    private final StockRepository stockRepository;
    private final ItemMapper itemMapper;
    private final ItemStockStatusService itemStockStatusService;
    private final CurrentOrganizationService currentOrganizationService;

    public ItemServiceImpl(
            ItemRepository itemRepository,
            CategoryRepository categoryRepository,
            SubCategoryRepository subCategoryRepository,
            BrandRepository brandRepository,
            UnitRepository unitRepository,
            WarehouseRepository warehouseRepository,
            ItemPriceRepository itemPriceRepository,
            ItemBatchRepository itemBatchRepository,
            StockRepository stockRepository,
            ItemMapper itemMapper,
            ItemStockStatusService itemStockStatusService,
            CurrentOrganizationService currentOrganizationService
    ) {
        this.itemRepository = itemRepository;
        this.categoryRepository = categoryRepository;
        this.subCategoryRepository = subCategoryRepository;
        this.brandRepository = brandRepository;
        this.unitRepository = unitRepository;
        this.warehouseRepository = warehouseRepository;
        this.itemPriceRepository = itemPriceRepository;
        this.itemBatchRepository = itemBatchRepository;
        this.stockRepository = stockRepository;
        this.itemMapper = itemMapper;
        this.itemStockStatusService = itemStockStatusService;
        this.currentOrganizationService = currentOrganizationService;
    }

    @Override
    @Transactional
    public ItemCreateResponseDto createItem(ItemRequestDto request) {
        validateItemDates(request);
        Organization organization = currentOrganizationService.getOrganizationReference();
        Long organizationId = organization.getId();
        if (itemRepository.existsByItemCodeIgnoreCaseAndOrganizationIdAndIsDeletedFalse(
                request.getItemCode(),
                organizationId)) {
            throw new BadRequestException(ErrorMessage.ITEM_ALREADY_EXISTS, "ITEM_ALREADY_EXISTS");
        }

        Warehouse warehouse = getActiveWarehouse(request.getWarehouseId());
        Item item = itemMapper.toEntity(request);
        item.setOrganization(organization);
        applyRelationships(item, request);
        Item savedItem = itemRepository.save(item);

        itemPriceRepository.save(buildPrice(savedItem, request, null));
        ItemBatch batch = itemBatchRepository.save(buildBatch(savedItem, request, null));
        stockRepository.save(buildStock(savedItem, warehouse, batch, request, null));
        itemStockStatusService.refreshStatus(savedItem);

        return ItemCreateResponseDto.builder()
                .id(savedItem.getId())
                .itemCode(savedItem.getItemCode())
                .build();
    }

    @Override
    @Transactional(readOnly = true)
    public ItemDetailResponseDto getItemById(Long id) {
        Item item = getActiveItem(id);
        ItemDetailResponseDto response = itemMapper.toDetailResponse(item);
        itemPriceRepository.findTopByItemIdOrderByIdDesc(id)
                .ifPresent(price -> applyPrice(response, price));
        itemBatchRepository.findTopByItemIdOrderByIdDesc(id)
                .ifPresent(batch -> applyBatch(response, batch));
        stockRepository.findByItemId(id).stream()
                .findFirst()
                .ifPresent(stock -> applyStock(response, stock));
        return response;
    }

    @Override
    @Transactional(readOnly = true)
    public PageResponseDto<ItemListResponseDto> getItems(
            int page,
            int size,
            String search,
            Long categoryId,
            Long brandId,
            Long warehouseId,
            ItemStatus status
    ) {
        Long organizationId = currentOrganizationService.getOrganizationId();
        Specification<Item> specification = ItemSpecification.notDeleted()
                .and(ItemSpecification.organization(organizationId))
                .and(ItemSpecification.category(categoryId))
                .and(ItemSpecification.brand(brandId))
                .and(ItemSpecification.warehouse(warehouseId))
                .and(ItemSpecification.status(status))
                .and(ItemSpecification.search(search));
        Page<Item> items = itemRepository.findAll(
                specification,
                PageRequest.of(page, size, Sort.by(Sort.Direction.DESC, "id"))
        );

        Page<ItemListResponseDto> response = items.map(item -> {
            ItemListResponseDto itemResponse = itemMapper.toListResponse(item);
            itemPriceRepository.findTopByItemIdOrderByIdDesc(item.getId())
                    .ifPresent(price -> applyListPrice(itemResponse, price));
            itemBatchRepository.findTopByItemIdOrderByIdDesc(item.getId())
                    .ifPresent(batch -> applyListBatch(itemResponse, batch));
            applyListStock(itemResponse, item.getId(), warehouseId);
            return itemResponse;
        });
        return PageResponseDto.from(response);
    }

    @Override
    @Transactional
    public void updateItem(Long id, ItemRequestDto request) {
        validateItemDates(request);
        Item item = getActiveItem(id);
        Long organizationId = currentOrganizationService.getOrganizationId();
        if (itemRepository.existsByItemCodeIgnoreCaseAndIdNotAndOrganizationIdAndIsDeletedFalse(
                request.getItemCode(),
                id,
                organizationId)) {
            throw new BadRequestException(ErrorMessage.ITEM_ALREADY_EXISTS, "ITEM_ALREADY_EXISTS");
        }

        Warehouse warehouse = getActiveWarehouse(request.getWarehouseId());
        itemMapper.updateEntity(request, item);
        applyRelationships(item, request);
        Item savedItem = itemRepository.save(item);

        ItemPrice price = itemPriceRepository.findTopByItemIdOrderByIdDesc(id)
                .orElse(null);
        itemPriceRepository.save(buildPrice(savedItem, request, price));

        ItemBatch batch = itemBatchRepository.findTopByItemIdOrderByIdDesc(id)
                .orElse(null);
        ItemBatch savedBatch = itemBatchRepository.save(buildBatch(savedItem, request, batch));

        Stock stock = stockRepository.findFirstByItemIdAndWarehouseIdAndBatchId(
                        id,
                        warehouse.getId(),
                        savedBatch.getId()
                )
                .orElse(null);
        stockRepository.save(buildStock(savedItem, warehouse, savedBatch, request, stock));
        itemStockStatusService.refreshStatus(savedItem);
    }

    @Override
    @Transactional
    public void deleteItem(Long id) {
        Item item = getActiveItem(id);
        item.setIsDeleted(true);
        itemRepository.save(item);
    }

    @Override
    @Transactional(readOnly = true)
    public ItemStockResponseDto getItemStock(Long id) {
        Item item = getActiveItem(id);
        List<Stock> stocks = stockRepository.findByItemId(id);
        BigDecimal availableQty = stocks.stream()
                .map(Stock::getAvailableQty)
                .map(this::defaultZero)
                .reduce(ZERO, BigDecimal::add);
        BigDecimal reservedQty = stocks.stream()
                .map(Stock::getReservedQty)
                .map(this::defaultZero)
                .reduce(ZERO, BigDecimal::add);
        String warehouse = stocks.stream()
                .findFirst()
                .map(Stock::getWarehouse)
                .map(Warehouse::getName)
                .orElse(null);

        return ItemStockResponseDto.builder()
                .itemId(item.getId())
                .itemName(item.getItemName())
                .availableQty(availableQty)
                .reservedQty(reservedQty)
                .warehouse(warehouse)
                .build();
    }

    private void applyRelationships(Item item, ItemRequestDto request) {
        Category category = getActiveCategory(request.getCategoryId());
        item.setCategory(category);

        item.setBrand(getActiveBrand(request.getBrandId(), category.getId()));
        item.setBaseUnit(getActiveUnit(request.getBaseUnitId()));

    }

    private ItemPrice buildPrice(Item item, ItemRequestDto request, ItemPrice price) {
        ItemPrice target = price == null ? new ItemPrice() : price;
        target.setItem(item);
        target.setPurchasePrice(request.getPurchasePrice());
        target.setPurchasePriceWithTax(request.getPurchasePriceWithTax());
        target.setTaxPercentage(request.getTaxPercentage());
        target.setSalePrice(request.getSalePrice());
        target.setWholesalePrice(request.getWholesalePrice());
        target.setMrp(request.getMrp());
        target.setMsp(request.getMsp());
        target.setDiscountPercentage(request.getDiscountPercentage());
        target.setProfitMargin(request.getProfitMargin());
        if (target.getEffectiveFrom() == null) {
            target.setEffectiveFrom(LocalDate.now());
        }
        return target;
    }

    private ItemBatch buildBatch(Item item, ItemRequestDto request, ItemBatch batch) {
        ItemBatch target = batch == null ? new ItemBatch() : batch;
        target.setItem(item);
        target.setBatchNo(request.getBatchNo());
        target.setManufacturingDate(request.getManufacturingDate());
        target.setExpiryDate(request.getExpiryDate());
        return target;
    }

    private Stock buildStock(Item item, Warehouse warehouse, ItemBatch batch, ItemRequestDto request, Stock stock) {
        Stock target = stock == null ? new Stock() : stock;
        target.setItem(item);
        target.setWarehouse(warehouse);
        target.setBatch(batch);
        target.setAvailableQty(request.getOpeningQuantity());
        target.setReservedQty(defaultZero(target.getReservedQty()));
        target.setMinimumStock(request.getMinimumStock());
        target.setReorderLevel(request.getMinimumStock());
        return target;
    }

    private void applyPrice(ItemDetailResponseDto response, ItemPrice price) {
        response.setPurchasePrice(price.getPurchasePrice());
        response.setPurchasePriceWithTax(price.getPurchasePriceWithTax());
        response.setTaxPercentage(price.getTaxPercentage());
        response.setSalePrice(price.getSalePrice());
        response.setWholesalePrice(price.getWholesalePrice());
        response.setMrp(price.getMrp());
        response.setMsp(price.getMsp());
        response.setDiscountPercentage(price.getDiscountPercentage());
        response.setProfitMargin(price.getProfitMargin());
    }

    private void applyBatch(ItemDetailResponseDto response, ItemBatch batch) {
        response.setBatchNo(batch.getBatchNo());
        response.setManufacturingDate(batch.getManufacturingDate());
        response.setExpiryDate(batch.getExpiryDate());
    }

    private void applyStock(ItemDetailResponseDto response, Stock stock) {
        response.setOpeningQuantity(stock.getAvailableQty());
        response.setAvailableQty(stock.getAvailableQty());
        response.setReservedQty(stock.getReservedQty());
        response.setMinimumStock(stock.getMinimumStock());
        if (stock.getWarehouse() != null) {
            response.setWarehouseId(stock.getWarehouse().getId());
            response.setWarehouseName(stock.getWarehouse().getName());
        }
    }

    private Item getActiveItem(Long id) {
        return itemRepository.findByIdAndOrganizationIdAndIsDeletedFalse(id, currentOrganizationService.getOrganizationId())
                .orElseThrow(() -> new ResourceNotFoundException(ErrorMessage.ITEM_NOT_FOUND, "ITEM_NOT_FOUND"));
    }

    private Category getActiveCategory(Long id) {
        return categoryRepository.findByIdAndOrganizationIdAndStatusAndIsDeletedFalse(
                        id,
                        currentOrganizationService.getOrganizationId(),
                        com.nexoraa.billtop.enums.Status.ACTIVE
                )
                .orElseThrow(() -> new ResourceNotFoundException(ErrorMessage.CATEGORY_NOT_FOUND, "CATEGORY_NOT_FOUND"));
    }

    private Brand getActiveBrand(Long id, Long categoryId) {
        return brandRepository.findByIdAndCategory_IdAndStatusAndIsDeletedFalse(
                        id,
                        categoryId,
                        com.nexoraa.billtop.enums.Status.ACTIVE
                )
                .orElseThrow(() -> new ResourceNotFoundException(ErrorMessage.BRAND_NOT_FOUND, "BRAND_NOT_FOUND"));
    }

    private Unit getActiveUnit(Long id) {
        if (id == null) {
            return null;
        }
        return unitRepository.findByIdAndOrganizationIdAndStatusAndIsDeletedFalse(id, currentOrganizationService.getOrganizationId(), com.nexoraa.billtop.enums.Status.ACTIVE)
                .orElseThrow(() -> new ResourceNotFoundException(ErrorMessage.UNIT_NOT_FOUND, "UNIT_NOT_FOUND"));
    }

    private Warehouse getActiveWarehouse(Long id) {
        return warehouseRepository.findByIdAndOrganizationIdAndStatus(id, currentOrganizationService.getOrganizationId(), com.nexoraa.billtop.enums.Status.ACTIVE)
                .orElseThrow(() -> new ResourceNotFoundException(ErrorMessage.WAREHOUSE_NOT_FOUND, "WAREHOUSE_NOT_FOUND"));
    }

    private void validateItemDates(ItemRequestDto request) {
        if (request.getManufacturingDate() != null
                && request.getExpiryDate() != null
                && request.getExpiryDate().isBefore(request.getManufacturingDate())) {
            throw new BadRequestException(ErrorMessage.INVALID_EXPIRY_DATE, "INVALID_EXPIRY_DATE");
        }
    }

    private void applyListStock(ItemListResponseDto response, Long itemId, Long warehouseId) {
        List<Stock> stocks = warehouseId == null || warehouseId <= 0
                ? stockRepository.findByItemId(itemId)
                : stockRepository.findByItemIdAndWarehouseIdOrderByIdAsc(itemId, warehouseId);
        BigDecimal availableQty = stocks.stream()
                .map(Stock::getAvailableQty)
                .map(this::defaultZero)
                .reduce(ZERO, BigDecimal::add);
        BigDecimal reservedQty = stocks.stream()
                .map(Stock::getReservedQty)
                .map(this::defaultZero)
                .reduce(ZERO, BigDecimal::add);
        response.setOpeningQuantity(availableQty);
        response.setAvailableQty(availableQty);
        response.setReservedQty(reservedQty);
        stocks.stream()
                .filter(stock -> stock.getWarehouse() != null)
                .findFirst()
                .ifPresent(stock -> {
                    response.setMinimumStock(stock.getMinimumStock());
                    response.setWarehouseId(stock.getWarehouse().getId());
                    response.setWarehouseName(stock.getWarehouse().getName());
                });
    }

    private void applyListPrice(ItemListResponseDto response, ItemPrice price) {
        response.setPurchasePrice(price.getPurchasePrice());
        response.setPurchasePriceWithTax(price.getPurchasePriceWithTax());
        response.setTaxPercentage(price.getTaxPercentage());
        response.setSalePrice(price.getSalePrice());
        response.setWholesalePrice(price.getWholesalePrice());
        response.setMrp(price.getMrp());
        response.setMsp(price.getMsp());
        response.setDiscountPercentage(price.getDiscountPercentage());
        response.setProfitMargin(price.getProfitMargin());
    }

    private void applyListBatch(ItemListResponseDto response, ItemBatch batch) {
        response.setBatchNo(batch.getBatchNo());
        response.setManufacturingDate(batch.getManufacturingDate());
        response.setExpiryDate(batch.getExpiryDate());
    }

    private BigDecimal defaultZero(BigDecimal value) {
        return value == null ? ZERO : value;
    }
}
