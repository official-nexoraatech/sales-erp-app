package com.nexoraa.billtop.dto.staff;

import com.nexoraa.billtop.enums.StaffAttendanceStatus;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class AttendanceSummaryResponseDto {

    private StaffAttendanceStatus status;
    private long count;
}
