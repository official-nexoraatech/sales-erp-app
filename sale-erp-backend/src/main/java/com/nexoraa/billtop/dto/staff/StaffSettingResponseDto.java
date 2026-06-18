package com.nexoraa.billtop.dto.staff;

import com.nexoraa.billtop.enums.Status;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class StaffSettingResponseDto {

    private Long id;
    private String name;
    private String description;
    private Status status;
}
