package domain.entity;

import jakarta.persistence.*;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.UUID;

@Entity
@Table(name = "scheme_navs")
public class SchemeNav extends BaseEntity {

    @Column(name = "scheme_id", nullable = false)
    private UUID schemeId;

    @Column(name = "nav_date", nullable = false)
    private LocalDate navDate;

    @Column(name = "nav_value", nullable = false, precision = 20, scale = 4)
    private BigDecimal navValue;
}
