package com.nexoraa.billtop.service;

import com.nexoraa.billtop.constants.ErrorMessage;
import com.nexoraa.billtop.dto.auth.LoginRequestDto;
import com.nexoraa.billtop.dto.auth.LoginResponseDto;
import com.nexoraa.billtop.exception.BadRequestException;
import com.nexoraa.billtop.security.BillTopUserDetails;
import com.nexoraa.billtop.security.JwtService;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.AuthenticationException;
import org.springframework.stereotype.Service;

@Service
public class AuthService {

    private final AuthenticationManager authenticationManager;
    private final JwtService jwtService;

    public AuthService(AuthenticationManager authenticationManager, JwtService jwtService) {
        this.authenticationManager = authenticationManager;
        this.jwtService = jwtService;
    }

    public LoginResponseDto login(LoginRequestDto request) {
        try {
            Authentication authentication = authenticationManager.authenticate(
                    UsernamePasswordAuthenticationToken.unauthenticated(request.getUserName(), request.getPassword())
            );

            BillTopUserDetails principal = (BillTopUserDetails) authentication.getPrincipal();
            return LoginResponseDto.builder()
                    .accessToken(jwtService.generateToken(principal))
                    .tokenType("Bearer")
                    .build();
        } catch (BadCredentialsException ex) {
            throw new BadRequestException(ErrorMessage.INVALID_CREDENTIALS, "INVALID_CREDENTIALS");
        } catch (AuthenticationException ex) {
            throw new BadRequestException(ErrorMessage.INVALID_CREDENTIALS, "INVALID_CREDENTIALS");
        } catch (Exception ex) {
            throw new BadRequestException(ErrorMessage.OPERATION_FAILED, "LOGIN_FAILED");
        }
    }
}
