package com.nexoraa.billtop.security;

import com.nexoraa.billtop.constants.ErrorMessage;
import com.nexoraa.billtop.entity.Branch;
import com.nexoraa.billtop.repository.BranchRepository;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.lang.NonNull;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.time.LocalDateTime;
import java.util.Optional;

/**
 * Validates the X-Branch-Id header (if present) against the authenticated
 * user's organization and assigned branches, and exposes the validated
 * branch id to the rest of the request via {@link BranchContext}.
 *
 * Runs as a servlet Filter (outside DispatcherServlet), so a rejected branch
 * is written directly as JSON here rather than thrown, mirroring
 * {@link RestAccessDeniedHandler}.
 */
@Component
public class BranchAuthorizationFilter extends OncePerRequestFilter {

    public static final String BRANCH_ID_HEADER = "X-Branch-Id";

    private final BranchRepository branchRepository;

    public BranchAuthorizationFilter(BranchRepository branchRepository) {
        this.branchRepository = branchRepository;
    }

    @Override
    protected void doFilterInternal(
            @NonNull HttpServletRequest request,
            @NonNull HttpServletResponse response,
            @NonNull FilterChain filterChain
    ) throws ServletException, IOException {
        String branchIdHeader = request.getHeader(BRANCH_ID_HEADER);
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();

        if (branchIdHeader == null || branchIdHeader.isBlank()
                || !(authentication != null && authentication.getPrincipal() instanceof BillTopUserDetails userDetails)) {
            filterChain.doFilter(request, response);
            return;
        }

        try {
            Long branchId = Long.valueOf(branchIdHeader.trim());
            Optional<Branch> branch = branchRepository.findById(branchId);

            if (branch.isEmpty()
                    || userDetails.organizationId() == null
                    || !branch.get().getOrganization().getId().equals(userDetails.organizationId())
                    || !userDetails.hasBranchAccess(branchId)) {
                writeForbidden(response, ErrorMessage.BRANCH_ACCESS_DENIED, "BRANCH_ACCESS_DENIED");
                return;
            }

            BranchContext.setBranchId(branchId);
            filterChain.doFilter(request, response);
        } catch (NumberFormatException ex) {
            writeForbidden(response, ErrorMessage.BRANCH_ACCESS_DENIED, "BRANCH_ID_INVALID");
        } finally {
            BranchContext.clear();
        }
    }

    private void writeForbidden(HttpServletResponse response, String message, String errorCode) throws IOException {
        response.setStatus(HttpStatus.FORBIDDEN.value());
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        response.getWriter().write("""
                {"success":false,"message":"%s","errorCode":"%s","timestamp":"%s"}
                """.formatted(escapeJson(message), errorCode, LocalDateTime.now()).trim());
    }

    private String escapeJson(String value) {
        return value.replace("\\", "\\\\").replace("\"", "\\\"");
    }
}
