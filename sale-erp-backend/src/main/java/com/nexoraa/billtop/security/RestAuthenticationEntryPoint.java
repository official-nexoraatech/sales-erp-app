package com.nexoraa.billtop.security;

import com.nexoraa.billtop.constants.ErrorMessage;
import io.jsonwebtoken.ExpiredJwtException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.security.core.AuthenticationException;
import org.springframework.security.web.AuthenticationEntryPoint;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.time.LocalDateTime;

@Component
public class RestAuthenticationEntryPoint implements AuthenticationEntryPoint {

    @Override
    public void commence(
            HttpServletRequest request,
            HttpServletResponse response,
            AuthenticationException authException
    ) throws IOException {
        Object tokenException = request.getAttribute(JwtAuthenticationFilter.JWT_EXCEPTION_ATTRIBUTE);
        String message = ErrorMessage.UNAUTHORIZED;
        if (tokenException instanceof ExpiredJwtException) {
            message = ErrorMessage.TOKEN_EXPIRED;
        } else if (tokenException != null) {
            message = ErrorMessage.TOKEN_INVALID;
        }

        response.setStatus(HttpStatus.UNAUTHORIZED.value());
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        response.getWriter().write(buildErrorResponse(message, "UNAUTHORIZED"));
    }

    private String buildErrorResponse(String message, String errorCode) {
        return """
                {"success":false,"message":"%s","errorCode":"%s","timestamp":"%s"}
                """.formatted(escapeJson(message), errorCode, LocalDateTime.now()).trim();
    }

    private String escapeJson(String value) {
        return value.replace("\\", "\\\\").replace("\"", "\\\"");
    }
}
