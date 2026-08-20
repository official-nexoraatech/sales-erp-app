package com.nexoraa.billtop.security;

import com.nexoraa.billtop.constants.ErrorMessage;
import com.nexoraa.billtop.entity.User;
import com.nexoraa.billtop.exception.UnauthorizedException;
import com.nexoraa.billtop.repository.UserRepository;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Service;

@Service
public class CurrentUserService {

    private final UserRepository userRepository;

    public CurrentUserService(UserRepository userRepository) {
        this.userRepository = userRepository;
    }

    public Long getUserId() {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication == null || !(authentication.getPrincipal() instanceof BillTopUserDetails userDetails)) {
            throw new UnauthorizedException(ErrorMessage.UNAUTHORIZED, "USER_CONTEXT_MISSING");
        }
        return userDetails.userId();
    }

    public User getUserReference() {
        return userRepository.getReferenceById(getUserId());
    }
}
