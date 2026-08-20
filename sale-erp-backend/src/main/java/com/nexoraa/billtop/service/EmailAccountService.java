package com.nexoraa.billtop.service;

import com.nexoraa.billtop.dto.email.ConnectEmailAccountRequestDto;
import com.nexoraa.billtop.dto.email.EmailAccountResponseDto;

public interface EmailAccountService {

    EmailAccountResponseDto connect(ConnectEmailAccountRequestDto request);

    EmailAccountResponseDto getMyAccount();

    void disconnect();
}
