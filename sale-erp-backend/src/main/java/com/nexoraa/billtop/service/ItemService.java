package com.nexoraa.billtop.service;

import com.nexoraa.billtop.dto.PageResponseDto;
import com.nexoraa.billtop.dto.common.FileUploadResponseDto;
import com.nexoraa.billtop.dto.item.ItemCreateResponseDto;
import com.nexoraa.billtop.dto.item.ItemDetailResponseDto;
import com.nexoraa.billtop.dto.item.ItemListResponseDto;
import com.nexoraa.billtop.dto.item.ItemRequestDto;
import com.nexoraa.billtop.dto.item.ItemStockResponseDto;
import com.nexoraa.billtop.enums.ItemStatus;
import org.springframework.web.multipart.MultipartFile;

public interface ItemService {

    ItemCreateResponseDto createItem(ItemRequestDto request);

    FileUploadResponseDto uploadItemLogo(Long id, MultipartFile file);

    ItemDetailResponseDto getItemById(Long id);

    PageResponseDto<ItemListResponseDto> getItems(
            int page,
            int size,
            String search,
            Long categoryId,
            Long brandId,
            Long warehouseId,
            ItemStatus status
    );

    void updateItem(Long id, ItemRequestDto request);

    void deleteItem(Long id);

    ItemStockResponseDto getItemStock(Long id);
}
