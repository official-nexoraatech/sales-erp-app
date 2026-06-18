package com.nexoraa.billtop.repository;

import com.nexoraa.billtop.enums.StaffAttendanceStatus;

public interface StaffAttendanceSummaryProjection {

    StaffAttendanceStatus getStatus();

    long getCount();
}
