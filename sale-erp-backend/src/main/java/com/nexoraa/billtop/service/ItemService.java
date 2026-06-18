package com.nexoraa.billtop.service;

import com.nexoraa.billtop.dto.PageResponseDto;
import com.nexoraa.billtop.dto.item.ItemCreateResponseDto;
import com.nexoraa.billtop.dto.item.ItemDetailResponseDto;
import com.nexoraa.billtop.dto.item.ItemListResponseDto;
import com.nexoraa.billtop.dto.item.ItemRequestDto;
import com.nexoraa.billtop.dto.item.ItemStockResponseDto;

public interface ItemService {

    ItemCreateResponseDto createItem(ItemRequestDto request);

    ItemDetailResponseDto getItemById(Long id);

    PageResponseDto<ItemListResponseDto> getItems(int page, int size, String search);

    void updateItem(Long id, ItemRequestDto request);

    void deleteItem(Long id);

    ItemStockResponseDto getItemStock(Long id);
}
