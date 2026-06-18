package com.nexoraa.billtop.dto.user;

import com.nexoraa.billtop.enums.Status;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class UserProfileResponseDto {

    private String firstName;
    private String lastName;
    private String userName;
    private String email;
    private String mobileNo;
    private String profileImageUrl;
    private Status status;
    private String roleName;
}
