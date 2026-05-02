package domain.entity;

import jakarta.persistence.*;
import commons.valueobject.Rta;

@Entity
@Table(name = "amcs")
public class Amc extends BaseEntity {

    @Column(name = "amc_code", nullable = false, unique = true, length = 20)
    private String amcCode;

    @Column(name = "name", nullable = false, length = 200)
    private String name;

    @Enumerated(EnumType.STRING)
    @Column(name = "rta", nullable = false, length = 20)
    private Rta rta;

    @Column(name = "is_active", nullable = false)
    private boolean isActive;
}
