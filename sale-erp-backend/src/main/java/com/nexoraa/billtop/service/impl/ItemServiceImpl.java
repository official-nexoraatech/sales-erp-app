package com.nexoraa.billtop.service.impl;

import com.nexoraa.billtop.constants.ErrorMessage;
import com.nexoraa.billtop.dto.PageResponseDto;
import com.nexoraa.billtop.dto.common.FileUploadResponseDto;
import com.nexoraa.billtop.dto.item.ItemCreateResponseDto;
import com.nexoraa.billtop.dto.item.ItemDetailResponseDto;
import com.nexoraa.billtop.dto.item.ItemListResponseDto;
import com.nexoraa.billtop.dto.item.ItemRequestDto;
import com.nexoraa.billtop.dto.item.ItemStockResponseDto;
import com.nexoraa.billtop.entity.Brand;
import com.nexoraa.billtop.entity.Category;
import com.nexoraa.billtop.entity.Item;
import com.nexoraa.billtop.entity.ItemPrice;
import com.nexoraa.billtop.entity.Organization;
import com.nexoraa.billtop.entity.Stock;
import com.nexoraa.billtop.entity.Unit;
import com.nexoraa.billtop.entity.Warehouse;
import com.nexoraa.billtop.enums.ItemStatus;
import com.nexoraa.billtop.enums.Status;
import com.nexoraa.billtop.exception.BadRequestException;
import com.nexoraa.billtop.exception.ResourceNotFoundException;
import com.nexoraa.billtop.mapper.ItemMapper;
import com.nexoraa.billtop.repository.BrandRepository;
import com.nexoraa.billtop.repository.CategoryRepository;
import com.nexoraa.billtop.repository.ItemPriceRepository;
import com.nexoraa.billtop.repository.ItemRepository;
import com.nexoraa.billtop.repository.OrganizationRepository;
import com.nexoraa.billtop.repository.StockRepository;
import com.nexoraa.billtop.repository.UnitRepository;
import com.nexoraa.billtop.repository.WarehouseRepository;
import com.nexoraa.billtop.security.CurrentOrganizationService;
import com.nexoraa.billtop.service.FileStorageService;
import com.nexoraa.billtop.service.ItemStockStatusService;
import com.nexoraa.billtop.service.ItemService;
import com.nexoraa.billtop.specification.ItemSpecification;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;

@Service
public class ItemServiceImpl implements ItemService {

    private static final BigDecimal ZERO = BigDecimal.ZERO;

    private final ItemRepository itemRepository;
    private final CategoryRepository categoryRepository;
    private final BrandRepository brandRepository;
    private final UnitRepository unitRepository;
    private final WarehouseRepository warehouseRepository;
    private final ItemPriceRepository itemPriceRepository;
    private final StockRepository stockRepository;
    private final OrganizationRepository organizationRepository;
    private final ItemMapper itemMapper;
    private final ItemStockStatusService itemStockStatusService;
    private final CurrentOrganizationService currentOrganizationService;
    private final FileStorageService fileStorageService;

    public ItemServiceImpl(
            ItemRepository itemRepository,
            CategoryRepository categoryRepository,
            BrandRepository brandRepository,
            UnitRepository unitRepository,
            WarehouseRepository warehouseRepository,
            ItemPriceRepository itemPriceRepository,
            StockRepository stockRepository,
            OrganizationRepository organizationRepository,
            ItemMapper itemMapper,
            ItemStockStatusService itemStockStatusService,
            CurrentOrganizationService currentOrganizationService,
            FileStorageService fileStorageService
    ) {
        this.itemRepository = itemRepository;
        this.categoryRepository = categoryRepository;
        this.brandRepository = brandRepository;
        this.unitRepository = unitRepository;
        this.warehouseRepository = warehouseRepository;
        this.itemPriceRepository = itemPriceRepository;
        this.stockRepository = stockRepository;
        this.organizationRepository = organizationRepository;
        this.itemMapper = itemMapper;
        this.itemStockStatusService = itemStockStatusService;
        this.currentOrganizationService = currentOrganizationService;
        this.fileStorageService = fileStorageService;
    }

    @Override
    @Transactional
    public ItemCreateResponseDto createItem(ItemRequestDto request) {
        validateItemDates(request);
        Organization organization = currentOrganizationService.getOrganizationReference();
        Long organizationId = organization.getId();
        boolean isItemPresent= itemRepository.existsByItemCodeIgnoreCaseAndOrganizationIdAndIsDeletedFalse(
                request.getItemCode(),
                organizationId);
        if (isItemPresent) {
            throw new BadRequestException(ErrorMessage.ITEM_ALREADY_EXISTS, "ITEM_ALREADY_EXISTS");
        }
        Item item = itemMapper.toEntity(request);
        item.setOrganization(organization);
        applyRelationships(item, request);
        Item savedItem = itemRepository.save(item);

        itemPriceRepository.save(buildPrice(savedItem, request, null));
        Warehouse warehouse = getActiveWarehouse(request.getWarehouseId());
        stockRepository.save(buildStock(savedItem, warehouse, request, null));
        itemStockStatusService.SaveItemStockStatus(savedItem);

        return ItemCreateResponseDto.builder()
                .id(savedItem.getId())
                .itemCode(savedItem.getItemCode())
                .build();
    }

    @Override
    @Transactional
    public FileUploadResponseDto uploadItemLogo(Long id, MultipartFile file) {
        Item item = getActiveItem(id);
        FileUploadResponseDto upload = fileStorageService.uploadImage(
                file,
                "organizations/" + item.getOrganization().getId() + "/items/" + item.getId()
        );
        item.setImageUrl(upload.getObjectUrl());
        itemRepository.save(item);
        return upload;
    }

    @Override
    @Transactional(readOnly = true)
    public ItemDetailResponseDto getItemById(Long id) {
        return buildDetailResponse(getActiveItem(id));
    }

    @Override
    @Transactional(readOnly = true)
    public ItemDetailResponseDto getItemByIdForOrganization(Long organizationId, Long id) {
        Organization organization = getActiveOrganization(organizationId);
        return buildDetailResponse(getActiveItem(id, organization.getId()));
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
        return listItems(currentOrganizationService.getOrganizationId(), page, size, search, categoryId, brandId, warehouseId, status);
    }

    @Override
    @Transactional(readOnly = true)
    public PageResponseDto<ItemListResponseDto> getItemsForAdmin(
            Long organizationId,
            int page,
            int size,
            String search,
            Long categoryId,
            Long brandId,
            Long warehouseId,
            ItemStatus status
    ) {
        Organization organization = getActiveOrganization(organizationId);
        return listItems(organization.getId(), page, size, search, categoryId, brandId, warehouseId, status);
    }

    private PageResponseDto<ItemListResponseDto> listItems(
            Long organizationId,
            int page,
            int size,
            String search,
            Long categoryId,
            Long brandId,
            Long warehouseId,
            ItemStatus status
    ) {
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
            itemResponse.setManufacturingDate(item.getManufacturingDate());
            itemResponse.setExpiryDate(item.getExpiryDate());
            applyListStock(itemResponse, item.getId(), warehouseId);
            return itemResponse;
        });
        return PageResponseDto.from(response);
    }

    private ItemDetailResponseDto buildDetailResponse(Item item) {
        ItemDetailResponseDto response = itemMapper.toDetailResponse(item);
        itemPriceRepository.findTopByItemIdOrderByIdDesc(item.getId())
                .ifPresent(price -> applyPrice(response, price));
        response.setManufacturingDate(item.getManufacturingDate());
        response.setExpiryDate(item.getExpiryDate());
        applyStock(response, item.getId());
        return response;
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


        itemMapper.updateEntity(request, item);
        applyRelationships(item, request);
        Item savedItem = itemRepository.save(item);

        ItemPrice price = itemPriceRepository.findTopByItemIdOrderByIdDesc(id)
                .orElse(null);
        itemPriceRepository.save(buildPrice(savedItem, request, price));
        Warehouse warehouse = getActiveWarehouse(request.getWarehouseId());
        Stock stock = stockRepository.findByItemId(id)
                .orElse(null);
        stockRepository.save(buildStock(savedItem, warehouse, request, stock));
        itemStockStatusService.SaveItemStockStatus(savedItem);
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
        return buildStockResponse(getActiveItem(id));
    }

    @Override
    @Transactional(readOnly = true)
    public ItemStockResponseDto getItemStockForOrganization(Long organizationId, Long id) {
        Organization organization = getActiveOrganization(organizationId);
        return buildStockResponse(getActiveItem(id, organization.getId()));
    }

    private ItemStockResponseDto buildStockResponse(Item item) {
        Stock stock = stockRepository.findFirstByItemIdOrderByIdAsc(item.getId());

        BigDecimal availableQty = stock != null ? defaultZero(stock.getAvailableQty()) : ZERO;
        BigDecimal reservedQty = stock != null ? defaultZero(stock.getReservedQty()) : ZERO;

        String warehouse = stock != null ? stock.getWarehouse().getName() : null;
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
        ItemPrice itemPrice = price == null ? new ItemPrice() : price;
        itemPrice.setItem(item);
        itemPrice.setPurchasePrice(request.getPurchasePrice());
        itemPrice.setTaxPercentage(request.getTaxPercentage());
        itemPrice.setSalePrice(request.getSalePrice());
        itemPrice.setWholesalePrice(request.getWholesalePrice());
        itemPrice.setMrp(request.getMrp());
        itemPrice.setMsp(request.getMsp());
        itemPrice.setDiscountPercentage(request.getDiscountPercentage());
        itemPrice.setProfitMargin(request.getProfitMargin());
        if (itemPrice.getEffectiveFrom() == null) {
            itemPrice.setEffectiveFrom(LocalDate.now());
        }
        return itemPrice;
    }

    private Stock buildStock(Item item, Warehouse warehouse, ItemRequestDto request, Stock stock) {
        Stock stockRequest = stock != null ? stock : new Stock();
        stockRequest.setItem(item);
        stockRequest.setWarehouse(warehouse);
        stockRequest.setAvailableQty(request.getOpeningQuantity());
        stockRequest.setReservedQty(request.getMinimumStock());
        stockRequest.setMinimumStock(request.getMinimumStock());
        stockRequest.setReorderLevel(request.getMinimumStock());
        return stockRequest;
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

    private void applyStock(ItemDetailResponseDto response, Long itemId) {
        Stock stock = stockRepository.findFirstByItemIdOrderByIdAsc(itemId);
        if (stock == null) {
            response.setOpeningQuantity(ZERO);
            response.setAvailableQty(ZERO);
            response.setReservedQty(ZERO);
            return;
        }
        BigDecimal availableQty = defaultZero(stock.getAvailableQty());
        BigDecimal reservedQty = defaultZero(stock.getReservedQty());
        response.setOpeningQuantity(availableQty);
        response.setAvailableQty(availableQty);
        response.setReservedQty(reservedQty);
        response.setMinimumStock(stock.getMinimumStock());
        if (stock.getWarehouse() != null) {
            response.setWarehouseId(stock.getWarehouse().getId());
            response.setWarehouseName(stock.getWarehouse().getName());
        }
    }

    private Item getActiveItem(Long id) {
        return getActiveItem(id, currentOrganizationService.getOrganizationId());
    }

    private Item getActiveItem(Long id, Long organizationId) {
        return itemRepository.findByIdAndOrganizationIdAndIsDeletedFalse(id, organizationId)
                .orElseThrow(() -> new ResourceNotFoundException(ErrorMessage.ITEM_NOT_FOUND, "ITEM_NOT_FOUND"));
    }

    private Organization getActiveOrganization(Long organizationId) {
        return organizationRepository.findByIdAndStatusAndIsDeletedFalse(organizationId, Status.ACTIVE)
                .orElseThrow(() -> new ResourceNotFoundException(ErrorMessage.ORGANIZATION_NOT_FOUND, "ORGANIZATION_NOT_FOUND"));
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

        Stock stock = stockRepository.findFirstByItemIdOrderByIdAsc(itemId);
        BigDecimal availableQty = stock != null ? defaultZero(stock.getAvailableQty()) : ZERO;
        BigDecimal reservedQty = stock != null ? defaultZero(stock.getReservedQty()) : ZERO;
        response.setOpeningQuantity(availableQty);
        response.setAvailableQty(availableQty);
        response.setReservedQty(reservedQty);
        if (stock != null && stock.getWarehouse() != null) {
            response.setMinimumStock(stock.getMinimumStock());
            response.setWarehouseId(stock.getWarehouse().getId());
            response.setWarehouseName(stock.getWarehouse().getName());
        }
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

    private BigDecimal defaultZero(BigDecimal value) {
        return value == null ? ZERO : value;
    }
}
